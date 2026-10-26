import { execFileSync } from "node:child_process";
import type { NextConfig } from "next";

function gitCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // `next dev` blocks its dev resources (hot reload) for hosts other than localhost,
  // and pages then never hydrate. List LAN hostnames/IPs here to develop over the network.
  allowedDevOrigins: (process.env.ALLOWED_DEV_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  env: { GIT_COMMIT: gitCommit() },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          // Not no-referrer: that makes browsers send `Origin: null` on same-origin
          // form posts, which the CSRF check in proxy.ts must reject.
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Content-Security-Policy",
            // 'unsafe-inline' is required for Next.js RSC/hydration and Tailwind inline styles.
            // Nonce-based CSP would require custom server instrumentation; not implemented here.
            value: [
              "default-src 'self'",
              // React's development build needs eval for its debugging features; production never does
              `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
              "style-src 'self' 'unsafe-inline'",
              "font-src 'self' data:",
              "img-src 'self' data:",
              "connect-src 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
