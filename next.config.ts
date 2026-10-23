import type { NextConfig } from "next";

const githubPages = process.env.GITHUB_PAGES === "1";
// Vercel 使用默认 Next 服务输出。本地预览仍走 standalone，不改历史提交的运行方式。
const onVercel = process.env.VERCEL === "1";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  compress: true,
  images: { unoptimized: true },
  trailingSlash: githubPages,
  basePath: githubPages ? "/-" : "",
  assetPrefix: githubPages ? "/-" : "",
};

if (githubPages) {
  nextConfig.output = "export";
} else if (!onVercel) {
  nextConfig.output = "standalone";
}

export default nextConfig;
