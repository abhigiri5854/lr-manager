import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // PDFs: Chromium is launched at run time, so these stay out of the bundle...
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  // ...and the fonts read from disk (lib/pdf/fonts.ts) and the Chromium binaries go with the routes.
  outputFileTracingIncludes: {
    "/pdf/**": ["./lib/pdf/fonts/*.woff2", "./node_modules/@sparticuz/chromium/bin/**"],
  },
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
