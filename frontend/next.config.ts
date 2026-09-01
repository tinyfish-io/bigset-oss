import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  env: {
    NEXT_PUBLIC_PROD: process.env.NEXT_PUBLIC_PROD ?? process.env.PROD ?? "",
  },
  devIndicators: false,
};

export default nextConfig;
