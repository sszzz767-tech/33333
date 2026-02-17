import { NextResponse } from "next/server";

// ---------- 环境变量 ----------
const DINGTALK_WEBHOOK = process.env.DINGTALK_WEBHOOK || "https://oapi.dingtalk.com/robot/send?access_token=你的token";
const RELAY_SERVICE_URL = process.env.RELAY_SERVICE_URL || "https://send-todingtalk-pnvjfgztkw.cn-hangzhou.fcapp.run";
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const USE_RELAY_SERVICE = process.env.USE_RELAY_SERVICE === "true";
const SEND_TO_DISCORD = process.env.SEND_TO_DISCORD === "true";
const DEFAULT_CAPITAL = parseFloat(process.env.DEFAULT_CAPITAL || "1000");
const IMAGE_BASE_URL = process.env.IMAGE_BASE_URL || "https://aa44444.vercel.app";

const lastEntryBySymbol = Object.create(null);

// ---------- 辅助解析函数 ----------
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
  const dir = getStr(text, "方向");
  if (!dir) return null;
  if (dir.includes("多") || dir.includes("buy") || dir.includes("Buy") || dir === "买") return "买";
  if (dir.includes("空") || dir.includes("sell") || dir.includes("Sell") || dir === "卖") return "卖";
  return null;
}

function getLatestPrice(text) {
  return getNum(text, "最新价格") || getNum(text, "当前价格") || getNum(text, "市价");
}

function formatPriceSmart(value) {
  if (value === null || value === undefined) return "-";
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || "-";
  }
  const strValue = value.toString();
  const decimalIndex = strValue.indexOf('.');
  if (decimalIndex === -1) return strValue;
  const decimalPart = strValue.substring(decimalIndex + 1);
  const decimalLength = decimalPart.length;
  if (decimalLength > 5) return value.toFixed(5);
  return strValue;
}

// ---------- 消息类型判断（使用 includes）----------
function isTP2(t) { return t.includes("TP2达成"); }
function isTP1(t) { return t.includes("TP1达成"); }
function isBreakeven(t) {
  return t.includes("已到保本位置") || t.includes("保本触发") || t.includes("保护位生效") || t.includes("保本位置");
}
function isBreakevenStop(t) {
  return t.includes("保本止损触发") || t.includes("保护触发") || t.includes("保護觸發");
}
function isInitialStop(t) {
  return t.includes("初始止损触发") || t.includes("止损触发") || t.includes("止損觸發");
}
function isEntry(t) {
  if (t.includes("开仓信号")) return true;
  return t.includes("开仓价格") && !isTP1(t) && !isTP2(t) && !isBreakeven(t) && !isBreakevenStop(t) && !isInitialStop(t);
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

// ---------- 图片价格获取函数（经过验证）----------
function getImagePrice(rawData, entryPrice) {
  console.log("=== getImagePrice 详细调试 ===");
  console.log("原始数据:", rawData);
  const latestPrice = getLatestPrice(rawData);
  console.log("- 最新价格:", latestPrice);
  const closingPrice = getNum(rawData, "平仓价格");
  console.log("- 平仓价格:", closingPrice);
  let triggerPrice = null;
  if (isTP1(rawData)) {
    triggerPrice = getNum(rawData, "TP1价格") || getNum(rawData, "TP1") || closingPrice;
    console.log("- TP1触发价格:", triggerPrice);
  } else if (isTP2(rawData)) {
    triggerPrice = getNum(rawData, "TP2价格") || getNum(rawData, "TP2") || closingPrice;
    console.log("- TP2触发价格:", triggerPrice);
  } else if (isBreakeven(rawData)) {
    triggerPrice = closingPrice || getNum(rawData, "触发价格") || getNum(rawData, "保本位") || getNum(rawData, "移动止损到保本位");
    console.log("- 保本触发价格:", triggerPrice);
    if (!triggerPrice) {
      const priceMatch = rawData.match(/(?:平仓价格|触发价格|保本位|移动止损到保本位)\s*[:：]\s*(\d+(?:\.\d+)?)/);
      if (priceMatch) {
        triggerPrice = parseFloat(priceMatch[1]);
        console.log("- 从文本提取的触发价格:", triggerPrice);
      }
    }
  }
  console.log("- 开仓价格:", entryPrice);
  let finalPrice;
  if (closingPrice) {
    finalPrice = closingPrice;
    console.log("- 使用平仓价格作为最终价格");
  } else {
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

// ---------- 构建 Cloudinary 图片 URL（最终版，USDT 自动跟随）----------
function generateImageURL(params) {
  const { symbol, direction, entry, price, capital = DEFAULT_CAPITAL } = params;

  // --- 1. 基础配置 ---
  const CLOUD_NAME = 'dtbc3aa1o';
  const BASE_IMAGE_ID = 'NEW1_bh9ysa';

  // --- 2. 计算盈利金额 ---
  const entryNum = parseFloat(entry);
  const priceNum = parseFloat(price);
  let profitAmount = 0;
  if (!isNaN(entryNum) && !isNaN(priceNum)) {
    if (direction === '卖') {
      profitAmount = DEFAULT_CAPITAL * 30 * ((entryNum - priceNum) / entryNum);
    } else {
      profitAmount = DEFAULT_CAPITAL * 30 * ((priceNum - entryNum) / entryNum);
    }
  }
  const displayProfit = (profitAmount > 0 ? '+' : '') + profitAmount.toFixed(2);
  const profitColor = profitAmount >= 0 ? '35b97c' : 'cc3333'; // 正绿负红

  // --- 3. 方向相关设置 ---
  const isSell = direction === '卖';
  const directionText = isSell ? '卖' : '买';
  const directionColor = isSell ? 'cc3333' : '35b97c';

  // --- 4. 动态计算 USDT 的 X 坐标 ---
  const profitXStart = 40;                // 盈利数字起始 X
  const profitCharWidth = 50;              // 每个字符估算宽度（85px 字体）
  const profitStrWidth = displayProfit.length * profitCharWidth;
  const usdtX = profitXStart + profitStrWidth + 20; // +20 固定间距
  const maxUsdtX = 750;                     // 图片宽度 950，留右边距
  const finalUsdtX = Math.min(usdtX, maxUsdtX);

  // --- 5. 获取当前时间（北京时间，格式 YYYY-MM-DD HH:mm:ss）---
  const now = new Date();
  const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const year = beijingTime.getUTCFullYear();
  const month = String(beijingTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(beijingTime.getUTCDate()).padStart(2, '0');
  const hours = String(beijingTime.getUTCHours()).padStart(2, '0');
  const minutes = String(beijingTime.getUTCMinutes()).padStart(2, '0');
  const seconds = String(beijingTime.getUTCSeconds()).padStart(2, '0');
  const displayTime = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;

  // --- 6. 构建完整 URL（逐层拼接）---
  let url = `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/`;

  // 时间图层
  url += `co_rgb:FFFFFF,l_text:arial_33_normal_left:${encodeURIComponent(displayTime)}`;
  url += `/fl_layer_apply,g_north_west,x_180,y_150/`;

  // 交易对图层
  url += `co_rgb:f0f0f0,l_text:arial_47_bold_normal_left:${encodeURIComponent(symbol.replace('.P', '') + ' 永续')}`;
  url += `/fl_layer_apply,g_north_west,x_50,y_400/`;

  // 方向图层
  url += `co_rgb:${directionColor},l_text:arial_35_bold_normal_left:${encodeURIComponent(directionText)}`;
  url += `/fl_layer_apply,g_north_west,x_56,y_480/`;

  // 盈利金额图层
  url += `co_rgb:${profitColor},l_text:open%20sans_95_bold_normal_left:${encodeURIComponent(displayProfit)}`;
  url += `/fl_layer_apply,g_north_west,x_40,y_590/`;

  // USDT 图层（动态 X 坐标）
  url += `co_rgb:f0f0f0,l_text:arial_50_bold_normal_left:USDT`;
  url += `/fl_layer_apply,g_north_west,x_${finalUsdtX},y_625/`;

  // 开仓价格图层
  url += `co_rgb:f0f0f0,l_text:arial_35_bold_normal_left:${encodeURIComponent(entry)}`;
  url += `/fl_layer_apply,g_north_west,x_60,y_830/`;

  // 最新价格图层
  url += `co_rgb:f0f0f0,l_text:arial_36_bold_normal_left:${encodeURIComponent(price)}`;
  url += `/fl_layer_apply,g_north_west,x_505,y_830/`;

  // 底图（添加 .png 后缀）
  url += BASE_IMAGE_ID + '.png';

  return url;
}

// ---------- 精简版消息格式化（增强字段提取）----------
function formatForDingTalk(raw) {
  const text = String(raw || "").replace(/\\u[\dA-Fa-f]{4}/g, '').replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')
    .replace(/[^\x00-\x7F\u4e00-\u9fa5\s]/g, '').replace(/\s+/g, ' ').trim();

  const symbol = getSymbol(text) || "SYMBOL";
  const direction = getDirection(text) || "买";
  const symbolLine = `${symbol} ｜ ${direction === '卖' ? '空頭' : '多頭'}`;

  const entryPrice = getNum(text, "开仓价格");
  const stopPrice = getNum(text, "止损价格") || getNum(text, "止损") || getNum(text, "风险") || getNum(text, "風險");
  const breakevenPrice = getNum(text, "保本位") || getNum(text, "保护") || getNum(text, "保護") || getNum(text, "保本");
  const tp1Price = getNum(text, "TP1") || getNum(text, "TP1价格");
  const tp2Price = getNum(text, "TP2") || getNum(text, "TP2价格");
  const triggerPrice = getNum(text, "触发价格") || getNum(text, "平仓价格");

  if (isEntry(text) && symbol && entryPrice != null) {
    lastEntryBySymbol[symbol] = { entry: entryPrice, t: Date.now() };
  }

  let body = "";
  if (isEntry(text)) {
    body =
      `⚡ 系統啟動\n` +
      `${symbolLine}\n\n` +
      `入場：${formatPriceSmart(entryPrice)}\n` +
      `風險：${formatPriceSmart(stopPrice)}\n` +
      `保護：${formatPriceSmart(breakevenPrice)}\n\n` +
      `階段一：${formatPriceSmart(tp1Price)}\n` +
      `階段二：${formatPriceSmart(tp2Price)}\n\n` +
      `狀態：持倉`;
  } else if (isBreakeven(text)) {
    body =
      `⚡ 倉位更新\n` +
      `${symbolLine}\n\n` +
      `保護位生效\n` +
      `風險轉移完成\n\n` +
      `保護：${formatPriceSmart(breakevenPrice || triggerPrice)}\n\n` +
      `狀態：已保護`;
  } else if (isTP1(text)) {
    body =
      `⚡ 階段推進\n` +
      `${symbolLine}\n\n` +
      `階段一完成\n` +
      `結構延伸中\n\n` +
      `狀態：持續持倉`;
  } else if (isTP2(text)) {
    body =
      `⚡ 階段完成\n` +
      `${symbolLine}\n\n` +
      `階段二完成\n` +
      `本輪結構結束\n\n` +
      `狀態：週期重置`;
  } else if (isBreakevenStop(text)) {
    body =
      `⚡ 倉位關閉\n` +
      `${symbolLine}\n\n` +
      `保護觸發\n` +
      `倉位平倉\n\n` +
      `風險已完全轉移\n\n` +
      `狀態：重置`;
  } else if (isInitialStop(text)) {
    body =
      `⚡ 週期關閉\n` +
      `${symbolLine}\n\n` +
      `風險觸發\n` +
      `倉位關閉\n\n` +
      `狀態：重置`;
  } else {
    body = text.replace(/,\s*/g, "\n").replace(/\\n/g, "\n");
  }
  return body;
}

// ---------- 发送到 Discord（完全仿照旧代码结构，无彩色）----------
async function sendToDiscord(messageData, imageUrl = null) {
  if (!SEND_TO_DISCORD || !DISCORD_WEBHOOK_URL) {
    console.log("Discord发送未启用或Webhook未配置，跳过");
    return { success: true, skipped: true };
  }

  try {
    console.log("=== 开始发送到Discord（完全仿照旧代码结构） ===");

    const embed = {
      title: " ",
      description: messageData,
      color: null,
      footer: { text: " " },
    };

    if (imageUrl) {
      embed.image = { url: imageUrl };
    }

    const discordPayload = {
      embeds: [embed]
    };

    const response = await fetch(DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
    console.error("Discord发送失败:", error);
    return { success: false, error: error.message, skipped: false };
  }
}

// ---------- POST 入口 ----------
export async function POST(req) {
  try {
    console.log("=== 收到TradingView Webhook请求 ===");
    const contentType = req.headers.get("content-type") || "";
    let raw;

    if (contentType.includes("application/json")) {
      const json = await req.json();
      raw = typeof json === "string" ? json : json?.message || json?.text || json?.content || JSON.stringify(json);
    } else {
      raw = await req.text();
    }

    const processedRaw = String(raw).replace(/\\u[\dA-Fa-f]{4}/g, '').replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')
      .replace(/[^\x00-\x7F\u4e00-\u9fa5\s]/g, '').replace(/\s+/g, ' ').trim();

    console.log("原始消息内容:", processedRaw);

    if (!processedRaw || !/(品种|方向|开仓|止损|TP1|TP2|保本|盈利|胜率|交易次数)/.test(processedRaw)) {
      console.log("无效或空白消息，跳过");
      return NextResponse.json({ ok: true, skipped: true, reason: "无效或空白消息" });
    }

    const formattedMessage = formatForDingTalk(processedRaw);
    const messageType = getMessageType(processedRaw);
    console.log("消息类型:", messageType);
    console.log("格式化消息预览:\n", formattedMessage);

    // 生成图片（仅保本/TP1/TP2）
    let imageUrl = null;
    if (isBreakeven(processedRaw) || isTP1(processedRaw) || isTP2(processedRaw)) {
      const symbol = getSymbol(processedRaw) || "SYMBOL";
      const direction = getDirection(processedRaw) || "买";
      const entry = getNum(processedRaw, "开仓价格") || (symbol && lastEntryBySymbol[symbol]?.entry) || null;
      const price = getImagePrice(processedRaw, entry);

      if (price !== null && !isNaN(price) && price !== '-') {
        imageUrl = generateImageURL({
          symbol,
          direction,
          entry,
          price,
          capital: DEFAULT_CAPITAL,
        });
        console.log("生成的图片URL:", imageUrl);
      } else {
        console.log("无法获取有效价格，跳过图片生成");
      }
    }

    // 并行发送（钉钉、Discord）
    const [dingtalkResult, discordResult] = await Promise.allSettled([
      // 钉钉发送
      (async () => {
        let finalMessage = formattedMessage;
        if (imageUrl) {
          finalMessage += `\n\n![交易图表](${imageUrl})`;
        }
        if (USE_RELAY_SERVICE) {
          const relayPayload = {
            message: finalMessage,
            needImage: false,
            imageParams: null,
            dingtalkWebhook: DINGTALK_WEBHOOK,
          };
          const resp = await fetch(RELAY_SERVICE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(relayPayload)
          });
          const data = await resp.json();
          if (!data.success) throw new Error(data.error);
          return { ok: true, relayData: data };
        } else {
          const markdown = {
            msgtype: "markdown",
            markdown: { title: "交易通知", text: finalMessage },
            at: { isAtAll: false }
          };
          const resp = await fetch(DINGTALK_WEBHOOK, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(markdown)
          });
          const data = await resp.json().catch(() => ({}));
          return { ok: true, dingTalk: data };
        }
      })(),

      // Discord 发送
      sendToDiscord(formattedMessage, imageUrl)
    ]);

    const results = {
      dingtalk: dingtalkResult.status === 'fulfilled' ? dingtalkResult.value : { error: dingtalkResult.reason?.message },
      discord: discordResult.status === 'fulfilled' ? discordResult.value : { error: discordResult.reason?.message }
    };

    console.log("最终发送结果:", results);
    return NextResponse.json({ ok: true, results });
  } catch (e) {
    console.error("处理请求时发生错误:", e);
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}

// ---------- GET 健康检查 ----------
export const dynamic = 'force-dynamic';
export async function GET() {
  return new Response(JSON.stringify({ message: 'TradingView Webhook API is running', timestamp: new Date().toISOString() }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
