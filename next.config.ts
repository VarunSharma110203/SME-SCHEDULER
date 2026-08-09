import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    cpus: 1,
    staticGenerationMaxConcurrency: 1,
  },
};

export default nextConfig;
