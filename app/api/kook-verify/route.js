// app/api/kook-verify/route.js
import { NextResponse } from "next/server";

// 环境变量
const KOOK_VERIFY_TOKEN = process.env.KOOK_VERIFY_TOKEN;

console.log("KOOK验证端点初始化，Verify Token:", KOOK_VERIFY_TOKEN ? "已设置" : "未设置");

// 极度简化的Challenge处理器
export async function POST(request) {
  try {
    console.log("=== 收到KOOK验证请求 ===");
    
    // 记录请求头
    const headers = Object.fromEntries(request.headers);
    console.log("请求头:", headers);
    
    // 解析JSON body
    let body;
    try {
      body = await request.json();
      console.log("请求体:", JSON.stringify(body, null, 2));
    } catch (error) {
      console.error("解析JSON失败:", error);
      return NextResponse.json(
        { error: "Invalid JSON" },
        { status: 400 }
      );
    }
    
    // 验证必需字段
    if (body.type !== 255) {
      console.error("无效的消息类型:", body.type);
      return NextResponse.json(
        { error: "Invalid message type" },
        { status: 400 }
      );
    }
    
    if (!body.challenge) {
      console.error("缺少challenge字段");
      return NextResponse.json(
        { error: "Missing challenge" },
        { status: 400 }
      );
    }
    
    if (!body.verify_token) {
      console.error("缺少verify_token字段");
      return NextResponse.json(
        { error: "Missing verify_token" },
        { status: 400 }
      );
    }
    
    // 验证Token
    console.log("验证Token:");
    console.log("收到的Token:", body.verify_token);
    console.log("期望的Token:", KOOK_VERIFY_TOKEN);
    console.log("Token匹配:", body.verify_token === KOOK_VERIFY_TOKEN);
    
    if (body.verify_token !== KOOK_VERIFY_TOKEN) {
      console.error("Token不匹配");
      return NextResponse.json(
        { error: "Verify token mismatch" },
        { status: 403 }
      );
    }
    
    // 返回成功的响应
    const response = { challenge: body.challenge };
    console.log("返回响应:", response);
    
    return NextResponse.json(response, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      }
    });
    
  } catch (error) {
    console.error("处理请求时出错:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// 用于测试的GET端点
export async function GET(request) {
  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  
  if (action === 'simulate-challenge') {
    // 模拟KOOK的Challenge请求
    const simulatedChallenge = "simulated_challenge_123";
    
    return NextResponse.json({
      message: "KOOK验证端点测试",
      endpoint: "/api/kook-verify",
      verify_token_configured: !!KOOK_VERIFY_TOKEN,
      verify_token_preview: KOOK_VERIFY_TOKEN ? 
        KOOK_VERIFY_TOKEN.substring(0, 4) + '...' + KOOK_VERIFY_TOKEN.substring(KOOK_VERIFY_TOKEN.length - 4) : 
        "未设置",
      simulated_request: {
        type: 255,
        challenge: simulatedChallenge,
        verify_token: KOOK_VERIFY_TOKEN
      },
      expected_response: {
        challenge: simulatedChallenge
      }
    });
  }
  
  return NextResponse.json({
    status: "KOOK验证端点运行正常",
    usage: {
      "POST /api/kook-verify": "处理KOOK Webhook验证",
      "GET /api/kook-verify?action=simulate-challenge": "测试验证逻辑"
    },
    verify_token_configured: !!KOOK_VERIFY_TOKEN,
    timestamp: new Date().toISOString()
  });
}

// 处理OPTIONS请求（CORS）
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
  });
}
