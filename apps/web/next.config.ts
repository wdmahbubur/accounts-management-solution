import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@ams/accounting",
    "@ams/contracts",
    "@ams/permissions",
    "@ams/reporting"
  ]
};

export default nextConfig;
