import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() { return [{ source: "/invite/:path*", headers: [
    { key: "Referrer-Policy", value: "no-referrer" }, { key: "Cache-Control", value: "private, no-store" },
    { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }
  ] }]; },
  transpilePackages: [
    "@ams/accounting",
    "@ams/contracts",
    "@ams/permissions",
    "@ams/reporting"
  ]
};

export default nextConfig;
