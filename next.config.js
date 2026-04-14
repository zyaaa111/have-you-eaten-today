const withPWA = require("next-pwa")({
  dest: "public",
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === "development",
});

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

function generateBuildInfo() {
  try {
    const commit = execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
    const buildTime = new Date().toISOString();
    const buildInfo = { commit, buildTime, version: require("./package.json").version };
    const outPath = path.join(__dirname, "public", "build-info.json");
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(buildInfo, null, 2), "utf-8");
  } catch (e) {
    console.warn("[build-info] 生成失败:", e.message);
  }
}

generateBuildInfo();

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: "dist",
  images: {
    unoptimized: true,
  },
  allowedDevOrigins: ["*.cpolar.cn", "*.nas.cpolar.cn"],
};

module.exports = withPWA(nextConfig);
