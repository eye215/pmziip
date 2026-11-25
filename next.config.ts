import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  ...(process.env.PMZIP_STATIC_EXPORT === "1"
    ? {
        output: "export",
        basePath: "/pmziip",
        trailingSlash: true,
      }
    : {
        async headers() {
          return [
            {
              source: "/(.*)",
              headers: [
                { key: "X-Content-Type-Options", value: "nosniff" },
                {
                  key: "Referrer-Policy",
                  value: "strict-origin-when-cross-origin",
                },
                {
                  key: "Permissions-Policy",
                  value: "camera=(), microphone=(), geolocation=()",
                },
              ],
            },
          ];
        },
      }),
};
export default config;
