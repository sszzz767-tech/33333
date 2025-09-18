// app/card/page.tsx
export default function CardPage() {
  return (
    <div
      className="relative w-[400px] h-[600px] bg-cover bg-center text-white p-6 rounded-xl shadow-lg"
      style={{ backgroundImage: "url('/card-bg.png')" }}
    >
      {/* 顶部信息 */}
      <div className="absolute top-6 left-6">
        <p className="text-sm">[2025-08-30 10:00:51]</p>
        <h2 className="text-xl font-bold">ETHUSDT.P</h2>
        <p className="text-lg">现价: 4283.00</p>
      </div>

      {/* 中间收益信息 */}
      <div className="absolute top-32 left-6">
        <p>系统操作：已清仓获利 ✅</p>
        <p>盈利状态：成功落袋 💰</p>
        <p className="text-green-400 text-2xl font-bold">+114.23%</p>
      </div>

      {/* 底部提示 */}
      <div className="absolute bottom-6 left-6">
        <p className="text-sm">🎉 恭喜！交易完美结束！</p>
      </div>
    </div>
  );
}
