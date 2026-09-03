import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/route": ["./data/**/*", "./public/data/**/*"],
  },
  agentRules: false,
};

export default nextConfig;
