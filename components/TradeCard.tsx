// components/TradeCard.tsx
import Image from "next/image";

export default function TradeCard({ symbol, entry, current, profit }: {
  symbol: string;
  entry: number;
  current: number;
  profit: number;
}) {
  return (
    <div className="max-w-md mx-auto bg-white rounded-2xl shadow-lg p-6">
      <h2 className="text-xl font-bold mb-2">📊 交易完成 {symbol}</h2>
      <p>开仓价格：<span className="font-mono">{entry}</span></p>
      <p>当前价格：<span className="font-mono">{current}</span></p>
      <p className={`font-bold ${profit >= 0 ? "text-green-600" : "text-red-600"}`}>
        收益：{profit.toFixed(2)}%
      </p>
      <div className="mt-4">
        <Image
          src="/binance.png" // 放在 public/binance.png
          alt="Binance"
          width={120}
          height={40}
        />
      </div>
    </div>
  );
}

