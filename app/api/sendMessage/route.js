import { NextResponse } from "next/server";

const DINGTALK_WEBHOOK = process.env.DINGTALK_WEBHOOK || "https://oapi.dingtalk.com/robot/send?access_token=a117def1fa7a3531c5d4e2c008842a571256cfec79cde5d5afbc2e20b668f344";
const RELAY_SERVICE_URL = process.env.RELAY_SERVICE_URL || "https://send-todingtalk-pnvjfgztkw.cn-hangzhou.fcapp.run";
const TENCENT_CLOUD_KOOK_URL = process.env.TENCENT_CLOUD_KOOK_URL || "https://1323960433-epanz6yymx.ap-guangzhou.tencentscf.com";
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const USE_RELAY_SERVICE = process.env.USE_RELAY_SERVICE === "true";
const SEND_TO_KOOK = process.env.SEND_TO_KOOK === "true";
const SEND_TO_DISCORD = process.env.SEND_TO_DISCORD === "true";
const DEFAULT_KOOK_CHANNEL_ID = process.env.DEFAULT_KOOK_CHANNEL_ID || "9709510381680957";

const lastEntryBySymbol = Object.create(null);

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
  return String(s).replace(/,\s*/g, "\n").replace(/\\n/g, "\n");
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

function getLatestPrice(text) {
  return getNum(text, "最新价格") || getNum(text, "当前价格") || getNum(text, "市价");
}

function formatPriceSmart(value) {
  if (value === null || value === undefined) return "-";
  
  if (typeof value === 'string') {
    const decimalIndex = value.indexOf('.');
    if (decimalIndex === -1) return value + ".00";
    
    const decimalPart = value.substring(decimalIndex + 1);
    const decimalLength = decimalPart.length;
    
    if (decimalLength === 0) return value + "00";
    if (decimalLength === 1) return value + "0";
    if (decimalLength > 5) {
      const integerPart = value.substring(0, decimalIndex);
      return integerPart + '.' + decimalPart.substring(0, 5);
    }
    
    return value;
  }
  
  const strValue = value.toString();
  const decimalIndex = strValue.indexOf('.');
  
  if (decimalIndex === -1) return strValue + ".00";
  
  const decimalPart = strValue.substring(decimalIndex + 1);
  const decimalLength = decimalPart.length;
  
  if (decimalLength === 0) return strValue + "00";
  if (decimalLength === 1) return strValue + "0";
  if (decimalLength > 5) return value.toFixed(5);
  
  return strValue;
}

function calcAbsProfitPct(entry, target) {
  if (entry == null || target == null) return null;
  const pct = ((target - entry) / entry) * 100;
  return Math.abs(pct);
}

function isTP2(t) { return /TP2达成/.test(t); }
function isTP1(t) { return /TP1达成/.test(t); }
function isBreakeven(t) { return /已到保本位置/.test(t); }
function isBreakevenStop(t) { return /保本止损.*触发/.test(t); }
function isInitialStop(t) { return /初始止损.*触发/.test(t); }
function isEntry(t) {
  return /【开仓】/.test(t) || (/开仓价格/.test(t) && !isTP1(t) && !isTP2(t) && !isBreakeven(t) && !isBreakevenStop(t) && !isInitialStop(t));
}

function extractProfitPctFromText(t) {
  const m = String(t).match(/(盈利|带杠杆盈利|累计带杠杆盈利)\s*[:：]?\s*([+-]?\d+(?:\.\d+)?)\s*%/);
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
  
  let hasSymbol = false, hasDirection = false, hasEntryPrice = false, hasTriggerPrice = false;
  let hasHoldTime = false, hasLossPercent = false, hasInstruction = false, hasPosition = false;
  let hasLeverage = false, hasProfit = false;
  
  for (const line of lines) {
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
    
    if ((isSymbolLine && hasSymbol) || (isDirectionLine && hasDirection) || (isEntryPriceLine && hasEntryPrice) || 
        (isTriggerPriceLine && hasTriggerPrice) || (isHoldTimeLine && hasHoldTime) || (isLossPercentLine && hasLossPercent) || 
        (isInstructionLine && hasInstruction) || (isPositionLine && hasPosition) || (isLeverageLine && hasLeverage) || 
        (isProfitLine && hasProfit)) continue;
    
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

// 修复的图片价格获取函数 - 确保保本位置也使用平仓价格
function getImagePrice(rawData, entryPrice) {
  console.log("=== getImagePrice 详细调试 ===");
  console.log("原始数据:", rawData);
  
  // 首先尝试获取最新价格
  const latestPrice = getLatestPrice(rawData);
  console.log("- 最新价格:", latestPrice);
  
  // 对于所有消息类型，都优先尝试获取平仓价格
  const closingPrice = getNum(rawData, "平仓价格");
  console.log("- 平仓价格:", closingPrice);
  
  // 根据消息类型获取其他触发价格
  let triggerPrice = null;
  if (isTP1(rawData)) {
    triggerPrice = getNum(rawData, "TP1价格") || getNum(rawData, "TP1") || closingPrice;
    console.log("- TP1触发价格:", triggerPrice);
  } else if (isTP2(rawData)) {
    triggerPrice = getNum(rawData, "TP2价格") || getNum(rawData, "TP2") || closingPrice;
    console.log("- TP2触发价格:", triggerPrice);
  } else if (isBreakeven(rawData)) {
    // 修复：保本位置消息也优先使用平仓价格
    triggerPrice = closingPrice || getNum(rawData, "触发价格") || getNum(rawData, "保本位") || getNum(rawData, "移动止损到保本位");
    console.log("- 保本触发价格:", triggerPrice);
    
    // 如果在保本位置消息中没有找到触发价格，尝试从文本中提取
    if (!triggerPrice) {
      console.log("- 尝试从保本消息文本中提取价格...");
      // 尝试匹配类似 "触发价格: 3220.33155" 或 "保本位: 3220.33155" 的格式
      const priceMatch = rawData.match(/(?:平仓价格|触发价格|保本位|移动止损到保本位)\s*[:：]\s*(\d+(?:\.\d+)?)/);
      if (priceMatch) {
        triggerPrice = parseFloat(priceMatch[1]);
        console.log("- 从文本提取的触发价格:", triggerPrice);
      }
    }
  }
  
  console.log("- 开仓价格:", entryPrice);
  
  // 价格优先级：平仓价格 > 最新价格 > 触发价格 > 开仓价格
  let finalPrice;
  if (closingPrice) {
    finalPrice = closingPrice;
    console.log("- 使用平仓价格作为最终价格");
  } else {
    // 对于保本位置消息，优先使用触发价格，其次最新价格，最后开仓价格
    if (isBreakeven(rawData)) {
      finalPrice = triggerPrice || latestPrice || entryPrice;
    } else {
      finalPrice = latestPrice || triggerPrice || entryPrice;
    }
  }
  
  console.log("- 最终选择的价格:", finalPrice);
  console.log("=== getImagePrice 调试结束 ===");
  
  return finalPrice;
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
    _t: Date.now().toString()
  }).toString();

  return `${BASE}/api/card-image?${qs}`;
}

const dingtalkEmojis = {
  "✅": "✅", "🎯": "🎯", "📈": "📈", "📊": "📊", "⚠️": "⚠️", "🔴": "🔴", "🟡": "🟡", 
  "🟢": "🟢", "🔄": "🔄", "⚖️": "⚖️", "💰": "💰", "🎉": "🎉", "✨": "✨"
};

function simplifyEmojis(text) {
  return text
    .replace(/\\uD83C\\uDFAF/g, dingtalkEmojis["🎯"]).replace(/\\uD83D\\uDFE1/g, dingtalkEmojis["🟡"])
    .replace(/\\uD83D\\uDFE2/g, dingtalkEmojis["🟢"]).replace(/\\uD83D\\uDD34/g, dingtalkEmojis["🔴"])
    .replace(/\\uD83D\\uDC4D/g, dingtalkEmojis["✅"]).replace(/\\u2705/g, dingtalkEmojis["✅"])
    .replace(/\\uD83D\\uDCC8/g, dingtalkEmojis["📈"]).replace(/\\uD83D\\uDCCA/g, dingtalkEmojis["📊"])
    .replace(/\\u26A0\\uFE0F/g, dingtalkEmojis["⚠️"]).replace(/\\uD83D\\uDD04/g, dingtalkEmojis["🔄"])
    .replace(/\\u2696\\uFE0F/g, dingtalkEmojis["⚖️"]).replace(/\\uD83D\\uDCB0/g, dingtalkEmojis["💰"])
    .replace(/\\uD83C\\uDF89/g, dingtalkEmojis["🎉"]).replace(/\\u2728/g, dingtalkEmojis["✨"]);
}

async function sendToKook(messageData, rawData, messageType, imageUrl = null) {
  if (!SEND_TO_KOOK) {
    console.log("KOOK发送未启用，跳过");
    return { success: true, skipped: true };
  }

  try {
    console.log("=== 开始发送到腾讯云KOOK服务 ===");
    const kookPayload = {
      channelId: DEFAULT_KOOK_CHANNEL_ID,
      formattedMessage: messageData,
      messageType: messageType,
      imageUrl: imageUrl,
      timestamp: Date.now(),
      symbol: getSymbol(rawData),
      direction: getDirection(rawData)
    };

    const response = await fetch(TENCENT_CLOUD_KOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(kookPayload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("腾讯云响应错误:", errorText);
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    console.log("腾讯云KOOK服务响应:", result);
    return { success: true, data: result };
  } catch (error) {
    console.error("发送到腾讯云KOOK服务失败:", error);
    return { success: false, error: error.message, skipped: false };
  }
}

async function sendToDiscord(messageData, rawData, messageType, imageUrl = null) {
  if (!SEND_TO_DISCORD || !DISCORD_WEBHOOK_URL) {
    console.log("Discord发送未启用或Webhook未配置，跳过");
    return { success: true, skipped: true };
  }

  try {
    console.log("=== 开始发送到Discord ===");
    let discordMessage = messageData
      .replace(/!\[.*?\]\(.*?\)/g, '')
      .replace(/📊 交易图表: https?:\/\/[^\s]+/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    
    if (!discordMessage || discordMessage.trim().length === 0) {
      console.log("Discord消息为空，跳过发送");
      return { success: true, skipped: true, reason: "空消息" };
    }
    
    let color = 0x0099FF;
    let title = "交易通知";
    switch(messageType) {
      case "TP2": color = 0x00FF00; title = "🎉 TP2 达成"; break;
      case "TP1": color = 0x00FF00; title = "✨ TP1 达成"; break;
      case "ENTRY": color = 0xFFFF00; title = "✅ 开仓信号"; break;
      case "BREAKEVEN": color = 0x00FF00; title = "🎯 已到保本位置"; break;
      case "BREAKEVEN_STOP": color = 0xFFA500; title = "🟡 保本止损触发"; break;
      case "INITIAL_STOP": color = 0xFF0000; title = "🔴 初始止损触发"; break;
    }
    
    const discordPayload = {
      content: `🔔 **${title}**`,
      embeds: [{
        title: "无限区块AI交易信号",
        description: discordMessage,
        color: color,
        timestamp: new Date().toISOString(),
        footer: { text: "无限社区-AI交易系统" }
      }]
    };

    if (imageUrl) {
      console.log("=== 强制重新生成Discord图片URL ===");
      const symbol = getSymbol(rawData);
      const direction = getDirection(rawData);
      const entryPrice = getNum(rawData, "开仓价格");
      
      // 使用修复后的价格获取函数
      const correctPrice = getImagePrice(rawData, entryPrice);
      const profitPercent = extractProfitPctFromText(rawData) || (entryPrice && correctPrice ? calcAbsProfitPct(entryPrice, correctPrice) : null);

      const pad = (n) => (n < 10 ? "0" + n : "" + n);
      const now = new Date();
      const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

      let status = "INFO";
      if (isTP1(rawData)) status = "TP1";
      if (isTP2(rawData)) status = "TP2";
      if (isBreakeven(rawData)) status = "BREAKEVEN";

      console.log("重新生成的参数:");
      console.log("- status:", status);
      console.log("- symbol:", symbol);
      console.log("- direction:", direction);
      console.log("- correctPrice:", correctPrice);
      console.log("- entryPrice:", entryPrice);
      console.log("- profitPercent:", profitPercent);

      const discordImageUrl = generateImageURL({
        status, symbol, direction, price: correctPrice, entry: entryPrice, profit: profitPercent, time: ts,
        BASE: "https://nextjs-boilerplate-ochre-nine-90.vercel.app"
      });

      console.log("原始图片URL:", imageUrl);
      console.log("重新生成的Discord图片URL:", discordImageUrl);
      discordPayload.embeds[0].image = { url: discordImageUrl };
    }

    const response = await fetch(DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      },
      body: JSON.stringify(discordPayload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Discord响应错误:", errorText);
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    console.log("Discord消息发送成功");
    return { success: true };
  } catch (error) {
    console.error("发送到Discord失败:", error);
    return { success: false, error: error.message, skipped: false };
  }
}

function getMessageType(text) {
  if (isTP2(text)) return "TP2";
  if (isTP1(text)) return "TP1";
  if (isBreakeven(text)) return "BREAKEVEN";
  if (isBreakevenStop(text)) return "BREAKEVEN_STOP";
  if (isInitialStop(text)) return "INITIAL_STOP";
  if (isEntry(text)) return "ENTRY";
  return "OTHER";
}

function isValidMessage(text) {
  if (!text || text.trim().length === 0) return false;
  const hasTradingKeywords = /(品种|方向|开仓|止损|TP1|TP2|保本|盈利|胜率|交易次数)/.test(text) || /(TP2达成|TP1达成|已到保本位置|保本止损|初始止损|【开仓】)/.test(text);
  return hasTradingKeywords;
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

  const entryPrice = entryFromText != null ? entryFromText : (symbol && lastEntryBySymbol[symbol] ? lastEntryBySymbol[symbol].entry : null);

  const triggerPrice = getNum(text, "平仓价格") || getNum(text, "触发价格") || getNum(text, "TP1价格") || 
    getNum(text, "TP2价格") || getNum(text, "TP1") || getNum(text, "TP2") || getNum(text, "保本位") || null;

  let profitPercent = extractProfitPctFromText(text);
  
  if (isEntry(text) && symbol && entryFromText != null) {
    lastEntryBySymbol[symbol] = { entry: entryFromText, t: Date.now() };
  }

  const BASE = "https://nextjs-boilerplate-ochre-nine-90.vercel.app";

  if (isTP2(text)) {
    if (profitPercent == null && entryPrice != null && triggerPrice != null) {
      profitPercent = calcAbsProfitPct(entryPrice, triggerPrice);
    }
    
    body = "🎉 TP2 达成 🎉\n\n" + `📈 品种: ${symbol || "-"}\n\n` + `📊 方向: ${direction || "-"}\n\n` + 
      `💰 开仓价格: ${formatPriceSmart(entryPrice)}\n\n` + (triggerPrice ? `🎯 TP2价格: ${formatPriceSmart(triggerPrice)}\n\n` : "") + 
      `📈 盈利: ${profitPercent != null ? Math.round(profitPercent) : "-"}%\n\n` + "✅ 已完全清仓\n\n";

    try {
      const latestPrice = getImagePrice(text, entryPrice);
      const pad = (n) => (n < 10 ? "0" + n : "" + n);
      const now = new Date();
      const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
      const imageUrl = generateImageURL({ status: "TP2", symbol, direction, price: latestPrice, entry: entryPrice, profit: profitPercent, time: ts, BASE });
      body += `![交易图表](${imageUrl})\n\n`;
    } catch (error) {
      console.error("生成图片时出错:", error);
    }
  } else if (isTP1(text)) {
    if (profitPercent == null && entryPrice != null && triggerPrice != null) {
      profitPercent = calcAbsProfitPct(entryPrice, triggerPrice);
    }
    body = "✨ TP1 达成 ✨\n\n" + `📈 品种: ${symbol || "-"}\n\n` + `📊 方向: ${direction || "-"}\n\n` + 
      `💰 开仓价格: ${formatPriceSmart(entryPrice)}\n\n` + (triggerPrice ? `🎯 TP1价格: ${formatPriceSmart(triggerPrice)}\n\n` : "") + 
      `📈 盈利: ${profitPercent != null ? Math.round(profitPercent) : "-"}%\n\n`;

    try {
      const latestPrice = getImagePrice(text, entryPrice);
      const pad = (n) => (n < 10 ? "0" + n : "" + n);
      const now = new Date();
      const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
      const imageUrl = generateImageURL({ status: "TP1", symbol, direction, price: latestPrice, entry: entryPrice, profit: profitPercent, time: ts, BASE });
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
    
    body = "🎯 已到保本位置 🎯\n\n" + `📈 品种: ${symbol || "-"}\n\n` + `📊 方向: ${direction || "-"}\n\n` + 
      `💰 开仓价格: ${formatPriceSmart(entryPrice)}\n\n` + (triggerPrice ? `🎯 触发价格: ${formatPriceSmart(triggerPrice)}\n\n` : "") + 
      (positionInfo.position ? `📊 仓位: ${positionInfo.position}\n\n` : "") + (positionInfo.leverage ? `⚖️ 杠杆倍数: ${positionInfo.leverage}\n\n` : "") + 
      (actualProfitPercent !== null ? `📈 盈利: ${actualProfitPercent.toFixed(2)}%\n\n` : "") + "⚠️ 请把止损移到开仓位置（保本）\n\n";

    try {
      const latestPrice = getImagePrice(text, entryPrice);
      const pad = (n) => (n < 10 ? "0" + n : "" + n);
      const now = new Date();
      const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
      const imageUrl = generateImageURL({ status: "BREAKEVEN", symbol, direction, price: latestPrice, entry: entryPrice, profit: actualProfitPercent, time: ts, BASE });
      body += `![交易图表](${imageUrl})\n\n`;
    } catch (error) {
      console.error("生成图片时出错:", error);
    }
  } else if (isBreakevenStop(text)) {
    body = "🟡 保本止损触发 🟡\n\n" + `📈 品种: ${symbol || "-"}\n\n` + `📊 方向: ${direction || "-"}\n\n` + 
      `💰 开仓价格: ${formatPriceSmart(entryPrice)}\n\n` + "🔄 系统操作: 清仓保护\n\n" + "✅ 风险状态: 已完全转移\n\n";
  } else if (isInitialStop(text)) {
    const triggerPrice = getNum(text, "触发价格");
    body = "🔴 初始止损触发 🔴\n\n" + `📈 品种: ${symbol || "-"}\n\n` + `📊 方向: ${direction || "-"}\n\n` + 
      `💰 开仓价格: ${formatPriceSmart(entryPrice)}\n\n` + (triggerPrice ? `🎯 触发价格: ${formatPriceSmart(triggerPrice)}\n\n` : "") + 
      "🔄 系统操作: 止损离场\n\n";
  } else if (isEntry(text)) {
    const days = getNum(text, "回测天数");
    const win = getNum(text, "胜率");
    const trades = getNum(text, "交易次数");
    const adjustedWin = adjustWinRate(win);
    const tp1Price = getNum(text, "TP1");
    const tp2Price = getNum(text, "TP2");
    const breakevenPrice = getNum(text, "保本位");

    body = "✅ 开仓信号 ✅\n\n" + "🟢 【开仓】 🟢\n\n" + `📈 品种: ${symbol ?? "-"}\n\n` + `📊 方向: ${direction ?? "-"}\n\n` + 
      `💰 开仓价格: ${formatPriceSmart(entryPrice)}\n\n` + `🛑 止损价格: ${formatPriceSmart(stopPrice)}\n\n` + 
      `🎯 保本位: ${formatPriceSmart(breakevenPrice)}\n\n` + `🎯 TP1: ${formatPriceSmart(tp1Price)}\n\n` + 
      `🎯 TP2: ${formatPriceSmart(tp2Price)}\n\n` + `📊 回测天数: ${days ?? "-"}\n\n` + 
      `📈 胜率: ${adjustedWin != null ? adjustedWin.toFixed(2) + "%" : "-"}\n\n` + `🔄 交易次数: ${trades ?? "-"}\n\n`;
  } else {
    body = toLines(text).replace(/\n/g, "\n\n");
  }

  const beijingTime = getBeijingTime();
  body += `\n⏰ 北京时间: ${beijingTime}\n`;
  return simplifyEmojis(header + body);
}

export async function POST(req) {
  try {
    console.log("=== 收到TradingView Webhook请求 ===");
    const contentType = req.headers.get("content-type") || "";
    let raw;

    if (contentType.includes("application/json")) {
      const json = await req.json();
      raw = typeof json === "string" ? json : json?.message || json?.text || json?.content || JSON.stringify(json || {});
    } else {
      raw = await req.text();
    }

    console.log("原始请求数据:", raw.substring(0, 500) + (raw.length > 500 ? "..." : ""));
    let processedRaw = String(raw || "").replace(/\\u[\dA-Fa-f]{4}/g, '').replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')
      .replace(/[^\x00-\x7F\u4e00-\u9fa5\s]/g, '').replace(/\s+/g, ' ').trim();
    console.log("处理后的消息:", processedRaw);

    if (!isValidMessage(processedRaw)) {
      console.log("收到无效或空白消息，跳过处理");
      return NextResponse.json({ ok: true, skipped: true, reason: "无效或空白消息" });
    }

    const formattedMessage = formatForDingTalk(processedRaw);
    const messageType = getMessageType(processedRaw);
    console.log("消息类型:", messageType);
    console.log("格式化消息预览:", formattedMessage.substring(0, 200) + (formattedMessage.length > 200 ? "..." : ""));

    let imageUrl = null;
    let needImage = false;

    if (isTP1(processedRaw) || isTP2(processedRaw) || isBreakeven(processedRaw)) {
      needImage = true;
      const symbol = getSymbol(processedRaw);
      const direction = getDirection(processedRaw);
      const entryPrice = getNum(processedRaw, "开仓价格");
      
      // 使用修复后的价格获取函数
      const latestPrice = getImagePrice(processedRaw, entryPrice);
      const profitPercent = extractProfitPctFromText(processedRaw) || (entryPrice && latestPrice ? calcAbsProfitPct(entryPrice, latestPrice) : null);

      const pad = (n) => (n < 10 ? "0" + n : "" + n);
      const now = new Date();
      const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

      let status = "INFO";
      if (isTP1(processedRaw)) status = "TP1";
      if (isTP2(processedRaw)) status = "TP2";
      if (isBreakeven(processedRaw)) status = "BREAKEVEN";

      imageUrl = generateImageURL({ status, symbol, direction, price: latestPrice, entry: entryPrice, profit: profitPercent, time: ts, BASE: "https://nextjs-boilerplate-ochre-nine-90.vercel.app" });
      console.log("生成的图片URL:", imageUrl);
    }

    console.log("=== 开始并行发送消息 ===");
    const [dingtalkResult, kookResult, discordResult] = await Promise.allSettled([
      (async () => {
        console.log("开始发送到钉钉...");
        if (USE_RELAY_SERVICE) {
          console.log("使用中继服务发送消息到钉钉...");
          const relayPayload = {
            message: formattedMessage, needImage, imageParams: imageUrl ? {
              status: messageType, symbol: getSymbol(processedRaw), direction: getDirection(processedRaw),
              price: getImagePrice(processedRaw, getNum(processedRaw, "开仓价格")), entry: getNum(processedRaw, "开仓价格"),
              profit: extractProfitPctFromText(processedRaw), time: new Date().toLocaleString('zh-CN')
            } : null, dingtalkWebhook: DINGTALK_WEBHOOK
          };
          console.log("中继服务请求负载:", relayPayload);
          const relayResponse = await fetch(RELAY_SERVICE_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(relayPayload) });
          const relayData = await relayResponse.json();
          console.log("中继服务响应:", relayData);
          if (!relayData.success) throw new Error(relayData.error || "中继服务返回错误");
          return { ok: true, relayData, method: "relay" };
        } else {
          console.log("直接发送到钉钉...");
          const markdown = { msgtype: "markdown", markdown: { title: "交易通知", text: formattedMessage }, at: { isAtAll: false } };
          console.log("发送的消息内容:", markdown.markdown.text);
          const resp = await fetch(DINGTALK_WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(markdown) });
          const data = await resp.json().catch(() => ({}));
          console.log("钉钉响应:", data);
          return { ok: true, dingTalk: data, method: "direct" };
        }
      })(),
      (async () => { console.log("开始发送到KOOK..."); return await sendToKook(formattedMessage, processedRaw, messageType, imageUrl); })(),
      (async () => { console.log("开始发送到Discord..."); return await sendToDiscord(formattedMessage, processedRaw, messageType, imageUrl); })()
    ]);

    const results = {
      dingtalk: dingtalkResult.status === 'fulfilled' ? dingtalkResult.value : { error: dingtalkResult.reason?.message },
      kook: kookResult.status === 'fulfilled' ? kookResult.value : { error: kookResult.reason?.message },
      discord: discordResult.status === 'fulfilled' ? discordResult.value : { error: discordResult.reason?.message }
    };

    console.log("=== 最终发送结果 ===");
    console.log("钉钉结果:", results.dingtalk);
    console.log("KOOK结果:", results.kook);
    console.log("Discord结果:", results.discord);

    return NextResponse.json({ ok: true, results, method: USE_RELAY_SERVICE ? "relay" : "direct" });
  } catch (e) {
    console.error("处理请求时发生错误:", e);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
