import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // PDFs: Chromium is launched at run time, so these stay out of the bundle...
  serverExternalPackages: [
    "@sparticuz/chromium",
    "puppeteer-core",
    // Smart import reader: native or worker-based, loaded from node_modules at run time.
    "pdfjs-dist",
    "@napi-rs/canvas",
    "sharp",
  ],
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
  // Driver app (/d/*): the token in the URL is a credential, so never leak it (no referrer), never index it,
  // never cache it, and load nothing from other origins.
  async headers() {
    const dev = process.env.NODE_ENV !== "production";
    const csp = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      `connect-src 'self'${dev ? " ws: wss:" : ""}`,
      "worker-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
    ].join("; ");
    return [
      {
        source: "/d/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Cache-Control", value: "no-store" },
          { key: "Content-Security-Policy", value: csp },
        ],
      },
    ];
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
