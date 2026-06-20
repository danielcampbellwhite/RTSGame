import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // Server Actions are stable in Next 16; raise the body limit for batch
    // simulation payloads passed back from the client.
    serverActions: {
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
