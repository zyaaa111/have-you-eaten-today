const withPWA = require("next-pwa")({
  dest: "public",
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === "development",
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: "dist",
  images: {
    unoptimized: true,
  },
  allowedDevOrigins: ["*.cpolar.cn", "*.nas.cpolar.cn"],
};

module.exports = withPWA(nextConfig);
