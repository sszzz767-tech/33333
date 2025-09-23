import { NextResponse } from "next/server";

// 环境变量配置
const DINGTALK_WEBHOOK =
  process.env.DINGTALK_WEBHOOK ||
  "https://oapi.dingtalk.com/robot/send?access_token=a117def1fa7a3531c5d4e2c008842a571256cfec79cde5d5afbc2e20b668f344";

// KOOK 环境变量
const KOOK_VERIFY_TOKEN = process.env.KOOK_VERIFY_TOKEN;
const KOOK_BOT_TOKEN = process.env.KOOK_BOT_TOKEN;

// 中继服务地址
const RELAY_SERVICE_URL = process.env.RELAY_SERVICE_URL || "https://send-todingtalk-pnvjfgztkw.cn-hangzhou.fcapp.run";
const USE_RELAY_SERVICE = process.env.USE_RELAY_SERVICE === "true";

const lastEntryBySymbol = Object.create(null);

// 获取北京时间函数
function getBeijingTime() {
  const now = new Date();
  const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  
  const year = beijingTime.getUTCFullYear();
  const month = String(beijingTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(beijingTime.getUTCDate()).padStart(2, '0');
  const hours = String(beijingTime.getUTCHours()).padStart(2, '0');
  const minutes = String(beijingTime.getUTCMinutes()).padStart(2, '0');
  
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function toLines(s) {
  return String(s)
    .replace(/,\s*/g, "\n")
    .replace(/\\n/g, "\n");
}

function getNum(text, key) {
  const re = new RegExp(`${key}\\s*[:：]\\s*([0-9]+(?:\\.[0-9]+)?)`);
  const m = String(text).match(re);
  return m ? parseFloat(m[1]) : null;
}

function getStr(text, key) {
  const re = new RegExp(`${key}\\s*[:：]\\s*([^,\\n]+)`);
  const m = String(text).match(re);
  return m ? m[1].trim() : null;
}

function getSymbol(text) {
  const symbol = getStr(text, "品种");
  return symbol ? symbol.split(' ')[0].replace(/[^a-zA-Z0-9.]/g, '') : null;
}

function getDirection(text) {
  const direction = getStr(text, "方向");
  return direction ? direction.replace(/[^多头空头]/g, '') : null;
}

function formatPriceSmart(value) {
  if (value === null || value === undefined) return "-";
  
  if (typeof value === 'string') {
    const decimalIndex = value.indexOf('.');
    if (decimalIndex === -1) {
      return value + ".00";
    }
    
    const decimalPart = value.substring(decimalIndex + 1);
    const decimalLength = decimalPart.length;
    
    if (decimalLength === 0) {
      return value + "00";
    } else if (decimalLength === 1) {
      return value + "0";
    } else if (decimalLength > 5) {
      const integerPart = value.substring(0, decimalIndex);
      return integerPart + '.' + decimalPart.substring(0, 5);
    }
    
    return value;
  }
  
  const strValue = value.toString();
  const decimalIndex = strValue.indexOf('.');
  
  if (decimalIndex === -1) {
    return strValue + ".00";
  }
  
  const decimalPart = strValue.substring(decimalIndex + 1);
  const decimalLength = decimalPart.length;
  
  if (decimalLength === 0) {
    return strValue + "00";
  } else if (decimalLength === 1) {
    return strValue + "0";
  } else if (decimalLength > 5) {
    return value.toFixed(5);
  }
  
  return strValue;
}

function calcAbsProfitPct(entry, target) {
  if (entry == null || target == null) return null;
  const pct = ((target - entry) / entry) * 100;
  return Math.abs(pct);
}

// 检测函数
function isTP2(t) {
  return /TP2达成/.test(t);
}
function isTP1(t) {
  return /TP1达成/.test(t);
}
function isBreakeven(t) {
  return /已到保本位置/.test(t);
}
function isBreakevenStop(t) {
  return /保本止损.*触发/.test(t);
}
function isInitialStop(t) {
  return /初始止损.*触发/.test(t);
}
function isEntry(t) {
  return (
    /【开仓】/.test(t) ||
    (/开仓价格/.test(t) &&
      !isTP1(t) &&
      !isTP2(t) &&
      !isBreakeven(t) &&
      !isBreakevenStop(t) &&
      !isInitialStop(t))
  );
}

function extractProfitPctFromText(t) {
  const m = String(t).match(
    /(盈利|带杠杆盈利|累计带杠杆盈利)\s*[:：]?\s*([+-]?\d+(?:\.\d+)?)\s*%/
  );
  return m ? Number(m[2]) : null;
}

function adjustWinRate(winRate) {
  if (winRate === null || winRate === undefined) return null;
  const adjusted = Math.min(100, winRate + 3);
  return parseFloat(adjusted.toFixed(2));
}

function removeDuplicateLines(text) {
  const lines = text.split('\n');
  const seen = new Set();
  const result = [];
  
  let hasSymbol = false;
  let hasDirection = false;
  let hasEntryPrice = false;
  let hasTriggerPrice = false;
  let hasHoldTime = false;
  let hasLossPercent = false;
  let hasInstruction = false;
  let hasPosition = false;
  let hasLeverage = false;
  let hasProfit = false;
  
  for ( const line of lines) {
    const trimmed = line.trim();
    
    if (!trimmed) continue;
    
    const isSymbolLine = /品种\s*[:：]/.test(trimmed);
    const isDirectionLine = /方向\s*[:：]/.test(trimmed);
    const isEntryPriceLine = /开仓价格\s*[:：]/.test(trimmed);
    const isTriggerPriceLine = /触发价格\s*[:：]/.test(trimmed);
    const isHoldTimeLine = /持仓时间\s*[:：]/.test(trimmed);
    const isLossPercentLine = /损失比例\s*[:：]/.test(trimmed);
    const isInstructionLine = /系统操作\s*[:：]/.test(trimmed);
    const isPositionLine = /仓位\s*[:：]/.test(trimmed);
    const isLeverageLine = /杠杆倍数\s*[:：]/.test(trimmed);
    const isProfitLine = /盈利\s*[:：]/.test(trimmed);
    
    if ((isSymbolLine && hasSymbol) || 
        (isDirectionLine && hasDirection) || 
        (isEntryPriceLine && hasEntryPrice) || 
        (isTriggerPriceLine && hasTriggerPrice) || 
        (isHoldTimeLine && hasHoldTime) || 
        (isLossPercentLine && hasLossPercent) || 
        (isInstructionLine && hasInstruction) ||
        (isPositionLine && hasPosition) ||
        (isLeverageLine && hasLeverage) ||
        (isProfitLine && hasProfit)) {
      continue;
    }
    
    if (isSymbolLine) hasSymbol = true;
    if (isDirectionLine) hasDirection = true;
    if (isEntryPriceLine) hasEntryPrice = true;
    if (isTriggerPriceLine) hasTriggerPrice = true;
    if (isHoldTimeLine) hasHoldTime = true;
    if (isLossPercentLine) hasLossPercent = true;
    if (isInstructionLine) hasInstruction = true;
    if (isPositionLine) hasPosition = true;
    if (isLeverageLine) hasLeverage = true;
    if (isProfitLine) hasProfit = true;
    
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(line);
    }
  }
  
  return result.join('\n');
}

function extractPositionInfo(text) {
  const positionMatch = text.match(/开仓\s*(\d+(?:\.\d+)?)%\s*仓位/);
  const leverageMatch = text.match(/杠杆倍数\s*[:：]\s*(\d+)x/);
  const breakevenMatch = text.match(/移动止损到保本位\s*[:：]\s*(\d+(?:\.\d+)?)/);
  
  return {
    position: positionMatch ? positionMatch[1] + '%' : null,
    leverage: leverageMatch ? leverageMatch[1] + 'x' : null,
    breakeven: breakevenMatch ? breakevenMatch[1] : null
  };
}

function generateImageURL(params) {
  const { status, symbol, direction, price, entry, profit, time, BASE } = params;
  
  const cleanSymbol = symbol ? symbol.replace(/[^a-zA-Z0-9.]/g, '') : '';
  const cleanDirection = direction ? direction.replace(/[^多头空头]/g, '') : '';
  
  const qs = new URLSearchParams({
    status: status || "",
    symbol: cleanSymbol,
    direction: cleanDirection,
    price: price ? formatPriceSmart(price) : "",
    entry: entry ? formatPriceSmart(entry) : "",
    profit: profit != null ? profit.toFixed(2) : "",
    time: time || new Date().toLocaleString('zh-CN'),
  }).toString();

  return `${BASE}/api/card-image?${qs}`;
}

const dingtalkEmojis = {
  "✅": "✅",
  "🎯": "🎯",
  "📈": "📈",
  "📊": "📊",
  "⚠️": "⚠️",
  "🔴": "🔴",
  "🟡": "🟡",
  "🟢": "🟢",
  "🔄": "🔄",
  "⚖️": "⚖️",
  "💰": "💰",
  "🎉": "🎉",
  "✨": "✨"
};

function simplifyEmojis(text) {
  return text
    .replace(/\\uD83C\\uDFAF/g, dingtalkEmojis["🎯"])
    .replace(/\\uD83D\\uDFE1/g, dingtalkEmojis["🟡"])
    .replace(/\\uD83D\\uDFE2/g, dingtalkEmojis["🟢"])
    .replace(/\\uD83D\\uDD34/g, dingtalkEmojis["🔴"])
    .replace(/\\uD83D\\uDC4D/g, dingtalkEmojis["✅"])
    .replace(/\\u2705/g, dingtalkEmojis["✅"])
    .replace(/\\uD83D\\uDCC8/g, dingtalkEmojis["📈"])
    .replace(/\\uD83D\\uDCCA/g, dingtalkEmojis["📊"])
    .replace(/\\u26A0\\uFE0F/g, dingtalkEmojis["⚠️"])
    .replace(/\\uD83D\\uDD04/g, dingtalkEmojis["🔄"])
    .replace(/\\u2696\\uFE0F/g, dingtalkEmojis["⚖️"])
    .replace(/\\uD83D\\uDCB0/g, dingtalkEmojis["💰"])
    .replace(/\\uD83C\\uDF89/g, dingtalkEmojis["🎉"])
    .replace(/\\u2728/g, dingtalkEmojis["✨"]);
}

function formatForDingTalk(raw) {
  let text = String(raw || "")
    .replace(/\\u[\dA-Fa-f]{4}/g, '')
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')
    .replace(/[^\x00-\x7F\u4e00-\u9fa5\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  text = removeDuplicateLines(text);

  const header = "🤖 无限区块AI 🤖\n\n";
  let body = "";

  const symbol = getSymbol(text);
  const direction = getDirection(text) || "-";
  const entryFromText = getNum(text, "开仓价格");
  const stopPrice = getNum(text, "止损价格");

  const entryPrice =
    entryFromText != null
      ? entryFromText
      : symbol && lastEntryBySymbol[symbol]
      ? lastEntryBySymbol[symbol].entry
      : null;

  const triggerPrice = 
    getNum(text, "平仓价格") || 
    getNum(text, "触发价格") || 
    getNum(text, "TP1价格") || 
    getNum(text, "TP2价格") || 
    getNum(text, "TP1") || 
    getNum(text, "TP2") || 
    getNum(text, "保本位") || 
    null;

  let profitPercent = extractProfitPctFromText(text);
  
  if (isEntry(text) && symbol && entryFromText != null) {
    lastEntryBySymbol[symbol] = { entry: entryFromText, t: Date.now() };
  }

  const BASE = "https://nextjs-boilerplate-ochre-nine-90.vercel.app";

  if (isTP2(text)) {
    if (profitPercent == null && entryPrice != null && triggerPrice != null) {
      profitPercent = calcAbsProfitPct(entryPrice, triggerPrice);
    }
    
    body =
      "🎉 TP2 达成 🎉\n\n" +
      `📈 品种: ${symbol || "-"}\n\n` +
      `📊 方向: ${direction || "-"}\n\n` +
      `💰 开仓价格: ${formatPriceSmart(entryPrice)}\n\n` +
      (triggerPrice ? `🎯 TP2价格: ${formatPriceSmart(triggerPrice)}\n\n` : "") +
      `📈 盈利: ${profitPercent != null ? Math.round(profitPercent) : "-"}%\n\n` +
      "✅ 已完全清仓\n\n";

    try {
      const latest = triggerPrice;
      const pad = (n) => (n < 10 ? "0" + n : "" + n);
      const now = new Date();
      const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
        now.getDate()
      )} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(
        now.getSeconds()
      )}`;

      const imageUrl = generateImageURL({
        status: "TP2",
        symbol,
        direction,
        price: latest,
        entry: entryPrice,
        profit: profitPercent,
        time: ts,
        BASE
      });

      body += `![交易图表](${imageUrl})\n\n`;
    } catch (error) {
      console.error("生成图片时出错:", error);
    }
  } else if (isTP1(text)) {
    if (profitPercent == null && entryPrice != null && triggerPrice != null) {
      profitPercent = calcAbsProfitPct(entryPrice, triggerPrice);
    }
    body =
      "✨ TP1 达成 ✨\n\n" +
      `📈 品种: ${symbol || "-"}\n\n` +
      `📊 方向: ${direction || "-"}\n\n` +
      `💰 开仓价格: ${formatPriceSmart(entryPrice)}\n\n` +
      (triggerPrice ? `🎯 TP1价格: ${formatPriceSmart(triggerPrice)}\n\n` : "") +
      `📈 盈利: ${profitPercent != null ? Math.round(profitPercent) : "-"}%\n\n`;

    try {
      const latest = triggerPrice;
      const pad = (n) => (n < 10 ? "0" + n : "" + n);
      const now = new Date();
      const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
        now.getDate()
      )} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(
        now.getSeconds()
      )}`;

      const imageUrl = generateImageURL({
        status: "TP1",
        symbol,
        direction,
        price: latest,
        entry: entryPrice,
        profit: profitPercent,
        time: ts,
        BASE
      });

      body += `![交易图表](${imageUrl})\n\n`;
    } catch (error) {
      console.error("生成图片时出错:", error);
    }
  } else if (isBreakeven(text)) {
    const positionInfo = extractPositionInfo(text);
    
    let actualProfitPercent = extractProfitPctFromText(text);
    if (actualProfitPercent === null && entryPrice !== null && triggerPrice !== null) {
      actualProfitPercent = calcAbsProfitPct(entryPrice, triggerPrice);
    }
    
    body =
      "🎯 已到保本位置 🎯\n\n" +
      `📈 品种: ${symbol || "-"}\n\n` +
      `📊 方向: ${direction || "-"}\n\n` +
      `💰 开仓价格: ${formatPriceSmart(entryPrice)}\n\n` +
      (triggerPrice ? `🎯 触发价格: ${formatPriceSmart(triggerPrice)}\n\n` : "") +
      (positionInfo.position ? `📊 仓位: ${positionInfo.position}\n\n` : "") +
      (positionInfo.leverage ? `⚖️ 杠杆倍数: ${positionInfo.leverage}\n\n` : "") +
      (actualProfitPercent !== null ? `📈 盈利: ${actualProfitPercent.toFixed(2)}%\n\n` : "") +
      "⚠️ 请把止损移到开仓位置（保本）\n\n";

    try {
      const latest = triggerPrice;
      const pad = (n) => (n < 10 ? "0" + n : "" + n);
      const now = new Date();
      const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
        now.getDate()
      )} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(
        now.getSeconds()
      )}`;

      const imageUrl = generateImageURL({
        status: "BREAKEVEN",
        symbol,
        direction,
        price: latest,
        entry: entryPrice,
        profit: actualProfitPercent,
        time: ts,
        BASE
      });

      body += `![交易图表](${imageUrl})\n\n`;
    } catch (error) {
      console.error("生成图片时出错:", error);
    }
  } else if (isBreakevenStop(text)) {
    body =
      "🟡 保本止损触发 🟡\n\n" +
      `📈 品种: ${symbol || "-"}\n\n` +
      `📊 方向: ${direction || "-"}\n\n` +
      `💰 开仓价格: ${formatPriceSmart(entryPrice)}\n\n` +
      "🔄 系统操作: 清仓保护\n\n" +
      "✅ 风险状态: 已完全转移\n\n";
  } else if (isInitialStop(text)) {
    const triggerPrice = getNum(text, "触发价格");
    
    body =
      "🔴 初始止损触发 🔴\n\n" +
      `📈 品种: ${symbol || "-"}\n\n` +
      `📊 方向: ${direction || "-"}\n\n` +
      `💰 开仓价格: ${formatPriceSmart(entryPrice)}\n\n` +
      (triggerPrice ? `🎯 触发价格: ${formatPriceSmart(triggerPrice)}\n\n` : "") +
      "🔄 系统操作: 止损离场\n\n";
  } else if (isEntry(text)) {
    const days = getNum(text, "回测天数");
    const win = getNum(text, "胜率");
    const trades = getNum(text, "交易次数");
    
    const adjustedWin = adjustWinRate(win);

    const tp1Price = getNum(text, "TP1");
    const tp2Price = getNum(text, "TP2");
    const breakevenPrice = getNum(text, "保本位");

    body =
      "✅ 开仓信号 ✅\n\n" +
      "🟢 【开仓】 🟢\n\n" +
      `📈 品种: ${symbol ?? "-"}\n\n` +
      `📊 方向: ${direction ?? "-"}\n\n` +
      `💰 开仓价格: ${formatPriceSmart(entryPrice)}\n\n` +
      `🛑 止损价格: ${formatPriceSmart(stopPrice)}\n\n` +
      `🎯 保本位: ${formatPriceSmart(breakevenPrice)}\n\n` +
      `🎯 TP1: ${formatPriceSmart(tp1Price)}\n\n` +
      `🎯 TP2: ${formatPriceSmart(tp2Price)}\n\n` +
      `📊 回测天数: ${days ?? "-"}\n\n` +
      `📈 胜率: ${adjustedWin != null ? adjustedWin.toFixed(2) + "%" : "-"}\n\n` +
      `🔄 交易次数: ${trades ?? "-"}\n\n`;
  } else {
    body = toLines(text).replace(/\n/g, "\n\n");
  }

  const beijingTime = getBeijingTime();
  body += `\n⏰ 北京时间: ${beijingTime}\n`;

  return simplifyEmojis(header + body);
}

// 专门的 KOOK Challenge 处理器
function handleKookChallenge(body) {
  console.log("处理 KOOK Challenge 请求:", {
    verify_token_received: body.verify_token,
    challenge: body.challenge,
    verify_token_expected: KOOK_VERIFY_TOKEN
  });
  
  // 验证 Verify Token
  if (body.verify_token !== KOOK_VERIFY_TOKEN) {
    console.error("Verify Token 不匹配:", {
      received: body.verify_token,
      expected: KOOK_VERIFY_TOKEN
    });
    throw new Error("Invalid KOOK verify token");
  }
  
  console.log("Challenge 验证成功");
  return { challenge: body.challenge };
}

// 处理 KOOK 普通消息
function handleKookMessage(body) {
  let messageContent = body.content;
  const channelId = body.target_id;
  
  console.log("收到 KOOK 消息:", messageContent);
  
  // 移除@机器人的标记
  if (messageContent.includes('(met)') && messageContent.includes('(met)')) {
    messageContent = messageContent.replace(/\(met\)[^()]*\(met\)/g, '').trim();
  }
  
  const formattedMessage = formatForDingTalk(messageContent);
  
  // 可选：在KOOK中回复确认
  if (KOOK_BOT_TOKEN) {
    sendKookMessage(channelId, "✅ 消息已收到并处理").catch(console.error);
  }
  
  return { 
    formattedMessage,
    shouldForwardToDingTalk: true 
  };
}

// 发送消息到KOOK
async function sendKookMessage(channelId, content) {
  const response = await fetch("https://www.kookapp.cn/api/v3/message/create", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bot ${KOOK_BOT_TOKEN}`
    },
    body: JSON.stringify({
      target_id: channelId,
      content: content,
      type: 1
    })
  });
  
  if (!response.ok) {
    throw new Error(`KOOK API错误: ${response.status}`);
  }
  
  return await response.json();
}

// 发送到钉钉的辅助函数
async function sendToDingTalk(message, source = "未知") {
  const markdown = {
    msgtype: "markdown",
    markdown: {
      title: `来自 ${source} 的交易通知`,
      text: message,
    },
    at: { isAtAll: false },
  };

  const resp = await fetch(DINGTALK_WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(markdown),
  });

  if (!resp.ok) {
    throw new Error(`钉钉接口返回错误: ${resp.status}`);
  }
  
  return await resp.json();
}

// 主POST处理函数 - 修复Challenge处理
export async function POST(req) {
  try {
    const contentType = req.headers.get("content-type") || "";
    
    console.log("收到请求:", {
      contentType,
      url: req.url,
      method: req.method
    });

    if (contentType.includes("application/json")) {
      const body = await req.json();
      
      console.log("请求体类型:", body.type);
      console.log("完整请求体:", JSON.stringify(body, null, 2));
      
      // 首先检查是否是KOOK的Challenge请求
      if (body.type === 255 && body.challenge) {
        console.log("识别为KOOK Challenge请求");
        
        try {
          const challengeResult = handleKookChallenge(body);
          console.log("返回Challenge响应:", challengeResult);
          
          // 直接返回Challenge响应，不进行其他处理
          return NextResponse.json(challengeResult);
        } catch (error) {
          console.error("Challenge处理失败:", error);
          return NextResponse.json(
            { error: "Challenge verification failed" },
            { status: 403 }
          );
        }
      }
      
      // 处理KOOK普通消息
      if (body.type === 1) {
        console.log("识别为KOOK普通消息");
        
        try {
          const kookResult = handleKookMessage(body);
          
          if (kookResult.shouldForwardToDingTalk) {
            // 转发到钉钉
            await sendToDingTalk(kookResult.formattedMessage, "KOOK");
          }
          
          return NextResponse.json({ 
            code: 0, 
            message: "KOOK消息处理完成",
            source: "kook"
          });
        } catch (error) {
          console.error("KOOK消息处理失败:", error);
          return NextResponse.json(
            { error: "KOOK message processing failed" },
            { status: 500 }
          );
        }
      }
      
      // 处理普通钉钉消息（原有逻辑）
      console.log("识别为普通消息");
      let raw = typeof body === "string"
        ? body
        : body?.message || body?.text || body?.content || JSON.stringify(body || {});

      // 预处理原始消息
      let processedRaw = String(raw || "")
        .replace(/\\u[\dA-Fa-f]{4}/g, '')
        .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')
        .replace(/[^\x00-\x7F\u4e00-\u9fa5\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      console.log("处理后的消息:", processedRaw);

      const formattedMessage = formatForDingTalk(processedRaw);

      // 判断是否需要图片
      let needImage = false;
      let imageParams = null;

      if (isTP1(processedRaw) || isTP2(processedRaw) || isBreakeven(processedRaw)) {
        needImage = true;
        
        const symbol = getSymbol(processedRaw);
        const direction = getDirection(processedRaw);
        const entryPrice = getNum(processedRaw, "开仓价格");
        
        let triggerPrice = null;
        if (isTP1(processedRaw)) {
          triggerPrice = getNum(processedRaw, "TP1价格") || getNum(processedRaw, "TP1");
        } else if (isTP2(processedRaw)) {
          triggerPrice = getNum(processedRaw, "TP2价格") || getNum(processedRaw, "TP2");
        } else if (isBreakeven(processedRaw)) {
          triggerPrice = getNum(processedRaw, "保本位");
        }

        const profitPercent = extractProfitPctFromText(processedRaw) ||
          (entryPrice && triggerPrice ? calcAbsProfitPct(entryPrice, triggerPrice) : null);

        const pad = (n) => (n < 10 ? "0" + n : "" + n);
        const now = new Date();
        const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
          now.getDate()
        )} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(
          now.getSeconds()
        )}`;

        let status = "INFO";
        if (isTP1(processedRaw)) status = "TP1";
        if (isTP2(processedRaw)) status = "TP2";
        if (isBreakeven(processedRaw)) status = "BREAKEVEN";

        imageParams = {
          status,
          symbol,
          direction,
          price: triggerPrice,
          entry: entryPrice,
          profit: profitPercent,
          time: ts
        };
      }

      // 使用中继服务发送消息
      if (USE_RELAY_SERVICE) {
        console.log("使用中继服务发送消息...");

        const relayPayload = {
          message: formattedMessage,
          needImage,
          imageParams,
          dingtalkWebhook: DINGTALK_WEBHOOK
        };

        const relayResponse = await fetch(RELAY_SERVICE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(relayPayload),
        });

        const relayData = await relayResponse.json();
        
        if (!relayData.success) {
          throw new Error(relayData.error || "中继服务返回错误");
        }
        
        return NextResponse.json({ 
          ok: true, 
          relayData, 
          method: "relay",
          source: "direct" 
        });
      } else {
        // 直接发送到钉钉
        await sendToDingTalk(formattedMessage, "直接消息");
        
        return NextResponse.json({ 
          ok: true, 
          method: "direct",
          source: "direct" 
        });
      }
    }
    
    return NextResponse.json({ error: "Invalid content type" }, { status: 400 });
    
  } catch (error) {
    console.error("处理错误:", error);
    return NextResponse.json(
      { 
        ok: false, 
        error: String(error?.message || error),
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      },
      { status: 500 }
    );
  }
}

// GET请求用于测试和调试
export async function GET(req) {
  const url = new URL(req.url);
  const action = url.searchParams.get('action');
  
  // 测试KOOK验证
  if (action === 'test-kook-challenge') {
    const testChallenge = "test_challenge_12345";
    
    return NextResponse.json({
      message: "KOOK Challenge 测试",
      verify_token_configured: !!KOOK_VERIFY_TOKEN,
      test_challenge: testChallenge,
      expected_response: { challenge: testChallenge },
      verify_token_masked: KOOK_VERIFY_TOKEN ? "***" + KOOK_VERIFY_TOKEN.slice(-4) : "未设置"
    });
  }
  
  // 健康检查
  return NextResponse.json({
    status: "ok",
    service: "消息转发服务",
    supported_platforms: ["dingtalk", "kook"],
    timestamp: new Date().toISOString(),
    beijingTime: getBeijingTime(),
    environment: process.env.NODE_ENV,
    kook_configured: !!(KOOK_VERIFY_TOKEN && KOOK_BOT_TOKEN),
    dingtalk_configured: !!DINGTALK_WEBHOOK
  });
}
