const isDev = process.env.NODE_ENV === "development";

const devSecurityHeaders = [
  {
    source: "/(.*)",
    headers: [
      {
        key: "X-Content-Type-Options",
        value: "nosniff",
      },
      {
        key: "X-Frame-Options",
        value: "DENY",
      },
      {
        key: "Referrer-Policy",
        value: "strict-origin-when-cross-origin",
      },
      {
        key: "Content-Security-Policy",
        value:
          "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://eu.i.posthog.com https://eu-assets.i.posthog.com https://cdnjs.cloudflare.com; connect-src 'self' https://*.deepgram.com https://api.deepgram.com https://www.googletagmanager.com https://www.google-analytics.com wss://*.deepgram.com https://eu.i.posthog.com https://eu-assets.i.posthog.com https://cdnjs.cloudflare.com; worker-src 'self' blob: https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://www.googletagmanager.com https://www.google-analytics.com; font-src 'self' data:; media-src 'self' blob:;",
      },
    ],
  },
  {
    source: "/sw.js",
    headers: [
      {
        key: "Content-Type",
        value: "application/javascript; charset=utf-8",
      },
      {
        key: "Cache-Control",
        value: "no-cache, no-store, must-revalidate",
      },
      {
        key: "Content-Security-Policy",
        value:
          "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://eu.i.posthog.com https://eu-assets.i.posthog.com https://cdnjs.cloudflare.com; connect-src 'self' https://*.deepgram.com https://api.deepgram.com https://www.googletagmanager.com https://www.google-analytics.com wss://*.deepgram.com https://eu.i.posthog.com https://eu-assets.i.posthog.com https://cdnjs.cloudflare.com; worker-src 'self' blob: https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline';",
      },
    ],
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  assetPrefix: isDev ? undefined : "./",
  images: {
    unoptimized: true,
  },
  ...(isDev
    ? {
        async headers() {
          return devSecurityHeaders;
        },
      }
    : {}),
};

export default nextConfig;
