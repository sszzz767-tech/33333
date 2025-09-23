// lib/messageFormatter.js

// 复制你现有的所有辅助函数
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

// 主格式化函数
export function formatForDingTalk(raw) {
  // 这里放置你完整的 formatForDingTalk 函数内容
  // 由于代码很长，我复制核心部分：
  
  let text = String(raw || "")
    .replace(/\\u[\dA-Fa-f]{4}/g, '')
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')
    .replace(/[^\x00-\x7F\u4e00-\u9fa5\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  text = removeDuplicateLines(text);

  const header = "🤖 无限区块AI 🤖\n\n";
  let body = "";

  // ... 你原有的完整格式化逻辑
  // 这里需要复制你完整的 formatForDingTalk 函数
  
  return simplifyEmojis(header + body);
}

// 导出其他可能需要用的函数
export {
  getBeijingTime,
  getSymbol,
  getDirection,
  isTP1,
  isTP2,
  isBreakeven,
  isEntry
};
