/** @type {import('next').NextConfig} */
const nextConfig = {
  // 移除所有实验性配置，App Router 已经是稳定功能
  images: {
    unoptimized: true, // 如果您使用自定义图片处理
  },
}

module.exports = nextConfig
