import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // Server actions default to 1 MB; company logos may be up to 2 MB (plus form overhead).
    serverActions: { bodySizeLimit: "3mb" },
    // proxy.ts buffers request bodies; Smart import uploads go up to 10 MB (+ form overhead).
    proxyClientMaxBodySize: "12mb",
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
