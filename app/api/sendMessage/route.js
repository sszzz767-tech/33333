import { NextResponse } from "next/server";

const DINGTALK_WEBHOOK =
  process.env.DINGTALK_WEBHOOK ||
  "https://oapi.dingtalk.com/robot/send?access_token=d8a49f84681d1e8b6cddd7fa7607ad74a2825402b70c4b188cf6128ade4fc1f4";

// 中继服务地址 - 替换成你的函数计算地址！
const RELAY_SERVICE_URL = process.env.RELAY_SERVICE_URL || "https://send-todingtalk-pnvjfgztkw.cn-hangzhou.fcapp.run";

// 控制是否使用中继服务的开关
const USE_RELAY_SERVICE = process.env.USE_RELAY_SERVICE === "true"; // 设置为 "true" 启用中继

const lastEntryBySymbol = Object.create(null);

// 获取北京时间函数
function getBeijingTime() {
  const now = new Date();
  // 北京时间是UTC+8
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
  // 清理符号，只保留交易对部分
  return symbol ? symbol.split(' ')[0].replace(/[^a-zA-Z0-9.]/g, '') : null;
}

function getDirection(text) {
  const direction = getStr(text, "方向");
  // 清理方向，只保留"多头"或"空头"
  return direction ? direction.replace(/[^多头空头]/g, '') : null;
}

// 智能格式化价格，根据原始数据的小数位数显示，最多5位，最少2位
function formatPriceSmart(value) {
  if (value === null || value === undefined) return "-";
  
  // 如果是字符串，直接使用
  if (typeof value === 'string') {
    // 检查字符串中的小数位数
    const decimalIndex = value.indexOf('.');
    if (decimalIndex === -1) {
      return value + ".00"; // 没有小数部分，添加两位小数
    }
    
    const decimalPart = value.substring(decimalIndex + 1);
    const decimalLength = decimalPart.length;
    
    if (decimalLength === 0) {
      return value + "00"; // 只有小数点，添加两位小数
    } else if (decimalLength === 1) {
      return value + "0"; // 只有一位小数，补零
    } else if (decimalLength > 5) {
      // 超过5位小数，截断到5位，但保留原始字符串的精度
      const integerPart = value.substring(0, decimalIndex);
      return integerPart + '.' + decimalPart.substring(0, 5);
    }
    
    return value; // 2-5位小数，直接返回
  }
  
  // 如果是数字，转换为字符串处理
  const strValue = value.toString();
  const decimalIndex = strValue.indexOf('.');
  
  if (decimalIndex === -1) {
    return strValue + ".00"; // 没有小数部分，添加两位小数
  }
  
  const decimalPart = strValue.substring(decimalIndex + 1);
  const decimalLength = decimalPart.length;
  
  if (decimalLength === 0) {
    return strValue + "00"; // 只有小数点，添加两位小数
  } else if (decimalLength === 1) {
    return strValue + "0"; // 只有一位小数，补零
  } else if (decimalLength > 5) {
    return value.toFixed(5); // 超过5位小数，截断到5位
  }
  
  return strValue; // 2-5位小数，直接返回
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

// 胜率调整函数
function adjustWinRate(winRate) {
  if (winRate === null || winRate === undefined) return null;
  // 将胜率增加3%，但不超过100%
  const adjusted = Math.min(100, winRate + 3);
  return parseFloat(adjusted.toFixed(2));
}

// 移除重复内容的函数 - 增强版
function removeDuplicateLines(text) {
  const lines = text.split('\n');
  const seen = new Set();
  const result = [];
  
  // 提取关键信息，避免重复
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
    
    // 跳过空行
    if (!trimmed) continue;
    
    // 检查是否重复的关键信息
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
    
    // 如果已经见过这种类型的信息，跳过
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
    
    // 标记已见到的信息类型
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
    
    // 添加到结果
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(line);
    }
  }
  
  return result.join('\n');
}

// 提取仓位信息的函数
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

// 生成图片URL的函数 (保留用于直接发送)
function generateImageURL(params) {
  const { status, symbol, direction, price, entry, profit, time, BASE } = params;
  
  // 清理参数，确保URL正确
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

// 钉钉支持的简单表情符号映射
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

// 替换复杂的表情符号为钉钉支持的简单表情
function simplifyEmojis(text) {
  return text
    .replace(/\\uD83C\\uDFAF/g, dingtalkEmojis["🎯"]) // 🎯
    .replace(/\\uD83D\\uDFE1/g, dingtalkEmojis["🟡"]) // 🟡
    .replace(/\\uD83D\\uDFE2/g, dingtalkEmojis["🟢"]) // 🟢
    .replace(/\\uD83D\\uDD34/g, dingtalkEmojis["🔴"]) // 🔴
    .replace(/\\uD83D\\uDC4D/g, dingtalkEmojis["✅"]) // 👍 -> ✅
    .replace(/\\u2705/g, dingtalkEmojis["✅"]) // ✅
    .replace(/\\uD83D\\uDCC8/g, dingtalkEmojis["📈"]) // 📈
    .replace(/\\uD83D\\uDCCA/g, dingtalkEmojis["📊"]) // 📊
    .replace(/\\u26A0\\uFE0F/g, dingtalkEmojis["⚠️"]) // ⚠️
    .replace(/\\uD83D\\uDD04/g, dingtalkEmojis["🔄"]) // 🔄
    .replace(/\\u2696\\uFE0F/g, dingtalkEmojis["⚖️"]) // ⚖️
    .replace(/\\uD83D\\uDCB0/g, dingtalkEmojis["💰"]) // 💰
    .replace(/\\uD83C\\uDF89/g, dingtalkEmojis["🎉"]) // 🎉
    .replace(/\\u2728/g, dingtalkEmojis["✨"]); // ✨
}

function formatForDingTalk(raw) {
  // 首先清理所有可能的乱码，但保留中文和基本表情
  let text = String(raw || "")
    .replace(/\\u[\dA-Fa-f]{4}/g, '')  // 删除Unicode转义序列
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')  // 删除代理对（复杂表情符号）
    .replace(/[^\x00-\x7F\u4e00-\u9fa5\s]/g, '')  // 只保留ASCII、中文和空格
    .replace(/\s+/g, ' ')
    .trim();

  // 移除重复行
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

  // 获取触发价格（平仓价格）
  const triggerPrice = 
    getNum(text, "平仓价格") || 
    getNum(text, "触发价格") || 
    getNum(text, "TP1价格") || 
    getNum(text, "TP2价格") || 
    getNum(text, "TP1") || 
    getNum(text, "TP2") || 
    getNum(text, "保本位") || 
    null;

  // 提取盈利百分比
  let profitPercent = extractProfitPctFromText(text);
  
  if (isEntry(text) && symbol && entryFromText != null) {
    lastEntryBySymbol[symbol] = { entry: entryFromText, t: Date.now() };
  }

  // 获取BASE URL - 使用固定值确保正确
  const BASE = "https://nextjs-boilerplate-ochre-nine-90.vercel.app";

  // ===== 展示逻辑修改 =====
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
      // 删除了累计盈利的显示
      "✅ 已完全清仓\n\n";

    // 在TP2消息中附加图片
    try {
      // 直接使用触发价格而不是最新价格
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
      // 删除了累计盈利的显示

    // 在TP1消息中附加图片
    try {
      // 直接使用触发价格而不是最新价格
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
    // 提取仓位信息
    const positionInfo = extractPositionInfo(text);
    
    // 提取盈利百分比 - 从消息中获取实际盈利值
    let actualProfitPercent = extractProfitPctFromText(text);
    if (actualProfitPercent === null && entryPrice !== null && triggerPrice !== null) {
      // 如果没有提取到盈利百分比，计算实际盈利
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

    // 为保本位置消息附加图片
    try {
      // 直接使用触发价格而不是最新价格
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
    // 提取初始止损相关信息
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
    
    // 调整胜率显示（增加3%）
    const adjustedWin = adjustWinRate(win);

    // 获取TP1、TP2和保本位价格
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

  // 在所有消息末尾添加北京时间
  const beijingTime = getBeijingTime();
  body += `\n⏰ 北京时间: ${beijingTime}\n`;

  // 简化表情符号以确保钉钉兼容性
  return simplifyEmojis(header + body);
}

// -------- App Router Handler (POST only) --------
export async function POST(req) {
  try {
    const contentType = req.headers.get("content-type") || "";
    let raw;

    if (contentType.includes("application/json")) {
      const json = await req.json();
      raw =
        typeof json === "string"
          ? json
          : json?.message || json?.text || json?.content || JSON.stringify(json || {});
    } else {
      raw = await req.text();
    }

    // 对原始消息进行预处理，保留中文但删除乱码
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
      
      // 根据消息类型提取正确的触发价格
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
        price: triggerPrice, // 使用触发价格而不是最新价格
        entry: entryPrice,
        profit: profitPercent,
        time: ts
      };
    }

    // 使用中继服务发送消息
    if (USE_RELAY_SERVICE) {
      console.log("使用中继服务发送消息...");

      // 准备发送到中继服务的请求
      const relayPayload = {
        message: formattedMessage,
        needImage,
        imageParams,
        dingtalkWebhook: DINGTALK_WEBHOOK
      };

      console.log("中继服务请求负载:", relayPayload);

      // 调用中继服务
      const relayResponse = await fetch(RELAY_SERVICE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(relayPayload),
      });

      const relayData = await relayResponse.json();
      console.log("中继服务响应:", relayData);
      
      if (!relayData.success) {
        throw new Error(relayData.error || "中继服务返回错误");
      }
      
      return NextResponse.json({ ok: true, relayData, method: "relay" });
    } else {
      // 直接发送到钉钉（原有逻辑）
      console.log("直接发送到钉钉...");
      
      const markdown = {
        msgtype: "markdown",
        markdown: {
          title: "交易通知",
          text: formattedMessage,
        },
        at: { isAtAll: false },
      };

      console.log("发送的消息内容:", markdown.markdown.text);

      const resp = await fetch(DINGTALK_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(markdown),
      });

      const data = await resp.json().catch(() => ({}));
      console.log("钉钉响应:", data);
      
      return NextResponse.json({ ok: true, dingTalk: data, method: "direct" });
    }
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}
