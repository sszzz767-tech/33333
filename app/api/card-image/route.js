export async function GET(request) {
  try {
    // ==================== 添加调试信息开始 ====================
    console.log("=== 图片生成详细调试 ===");
    console.log("完整请求URL:", request.url);
    const { searchParams } = new URL(request.url);
    console.log("所有查询参数:");
    console.log("- status:", searchParams.get("status"));
    console.log("- symbol:", searchParams.get("symbol"));
    console.log("- direction:", searchParams.get("direction"));
    console.log("- price参数:", searchParams.get("price"), "(原始值)");
    console.log("- entry参数:", searchParams.get("entry"), "(原始值)");
    console.log("- profit参数:", searchParams.get("profit"));
    console.log("- time参数:", searchParams.get("time"));
    console.log("- _t参数:", searchParams.get("_t"));
    // ==================== 添加调试信息结束 ====================

    console.log("收到图片生成请求");
    console.log("查询参数:", Object.fromEntries(searchParams.entries()));

    // 在图片生成代码中，修改参数获取部分：

// 获取查询参数 - 修复price参数处理
const status = searchParams.get("status") || "ENTRY";
const symbol = searchParams.get("symbol") || "ETHUSDT.P";
const direction = searchParams.get("direction") || "买";

// 修复：确保price参数正确处理
const rawPrice = searchParams.get("price");
const rawEntry = searchParams.get("entry");

// 如果price为空，根据消息类型决定使用什么值
let priceDisplay = "-";
if (rawPrice) {
  priceDisplay = formatPriceSmart(rawPrice);
} else {
  // 对于不同状态的消息，使用不同的默认值
  if (status === "TP1" || status === "TP2") {
    // 对于止盈消息，如果没有price，使用entry作为备选
    priceDisplay = formatPriceSmart(rawEntry || "-");
  } else if (status === "BREAKEVEN") {
    // 对于保本消息，使用触发价格或entry
    priceDisplay = formatPriceSmart(rawEntry || "-");
  } else {
    priceDisplay = "-";
  }
}

const entry = formatPriceSmart(rawEntry || "4387.38");
const profit = searchParams.get("profit") || "115.18";
const time = searchParams.get("time") || new Date().toLocaleString('zh-CN');

// ==================== 验证最终显示的值 ====================
console.log("最终显示值:");
console.log("- price显示:", priceDisplay);
console.log("- entry显示:", entry);

    // 设置图片宽高
    const width = 600;
    const height = 350;

    // 根据方向设置颜色和文本
    let directionText = "买";
    let directionColor = "#00ff88"; // 绿色
    
    if (direction === "空头" || direction === "卖") {
      directionText = "卖";
      directionColor = "#ff4757"; // 红色
    }
    
    const profitColor = "#00ff88";

    // 使用 Cloudinary 图片链接
    let backgroundImageUrl = "https://res.cloudinary.com/dtbc3aa1o/image/upload/c_fill,w_600,h_350,g_auto/v1757087627/bi_yhyeuy.jpg";
    console.log("使用背景图片:", backgroundImageUrl);
    
    // 验证图片是否可访问
    let isAccessible = false;
    try {
      isAccessible = await isImageAccessible(backgroundImageUrl);
      console.log("图片可访问性:", isAccessible);
    } catch (error) {
      console.error("图片验证出错:", error);
      isAccessible = false;
    }
    
    if (!isAccessible) {
      console.error("Cloudinary 图片无法访问，使用备用方案");
      backgroundImageUrl = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KICA8ZGVmcz4KICAgIDxsaW5lYXJHcmFkaWVudCBpZD0iZ3JhZGllbnQiIHgxPSIwJSIgeTE9IjAlIiB4Mj0iMTAwJSIgeTI9IjEwMCUiPgogICAgICA8c3RvcCBvZmZzZXQ9IjAlIiBzdHlsZT0ic3RvcC1jb2xvcjojMGExZTE3O3N0b3Atb3BhY2l0eToxIiAvPgogICAgPC9saW5lYXJHcmFkaWVudD4KICA8L2RlZnM+CiAgPHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0idXJsKCNncmFkaWVudCkiIC8+Cjwvc3ZnPg==";
    }

    console.log("开始生成图片响应");

    // 返回图片响应
    return new ImageResponse(
      (
        <div
          style={{
            display: "flex",
            width: "100%",
            height: "100%",
            flexDirection: "column",
            backgroundColor: "#0a0e17",
            backgroundImage: `url(${backgroundImageUrl})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            fontFamily: '"PingFang SC", "Helvetica Neue", Arial, sans-serif',
            padding: "15px",
            position: "relative",
            overflow: "hidden",
          }}
        >
          {/* 内容容器 - 明确设置 display: flex */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              width: "100%",
              height: "100%",
              position: "relative",
            }}
          >
            {/* 交易对信息 */}
            <div
              style={{
                position: "absolute",
                left: "45px",
                top: "85px",
                fontSize: "22px",
                fontWeight: "bold",
                color: "#ffffff",
                display: "flex",
                alignItems: "center",
                gap: "8px"
              }}
            >
              <span style={{ color: directionColor }}>
                {directionText}
              </span>
              <span style={{ color: "#ffffff" }}>|</span>
              <span style={{ color: "#ffffff" }}>75x</span>
              <span style={{ color: "#ffffff" }}>|</span>
              <span style={{ color: "#ffffff" }}>
                {symbol.replace('.P', '')} 永续
              </span>
            </div>

            {/* 盈利百分比 */}
            <div
              style={{
                position: "absolute",
                left: "45px",
                top: "140px",
                color: profitColor,
                fontSize: "40px",
                fontWeight: "bold",
                display: "flex",
              }}
            >
              {parseFloat(profit) >= 0 ? "+" : ""}{profit}%
            </div>

            {/* 价格数值 - 上下排列 */}
            <div
              style={{
                position: "absolute",
                left: "170px",
                top: "220px",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}
            >
              <div style={{ 
                display: "flex",
                color: "#b8b800", 
                fontSize: "22px",
                fontWeight: "bold",
              }}>
                {entry}
              </div>
              <div style={{ 
                display: "flex",
                color: "#b8b800", 
                fontSize: "22px",
                fontWeight: "bold",
              }}>
                {price}
              </div>
            </div>

            {/* 底部信息 - 居中 */}
            <div
              style={{
                position: "absolute",
                left: "50%",
                bottom: "10px",
                transform: "translateX(-50%)",
                color: "#a0a0c0",
                fontSize: "16px",
                display: "flex",
              }}
            >
              无限区块AI
            </div>
          </div>
        </div>
      ),
      {
        width,
        height,
        headers: {
          'Cache-Control': 'public, max-age=3600',
        },
      }
    );
  } catch (error) {
    console.error("生成图片时出错:", error);
    
    return new Response(
      JSON.stringify({
        error: "生成图片失败",
        message: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          'Cache-Control': 'no-cache',
        },
      }
    );
  }
}
