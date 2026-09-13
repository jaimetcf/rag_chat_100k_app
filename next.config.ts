import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Hide the default Next.js dev tools badge (bottom-left in development). */
  devIndicators: false,
  serverExternalPackages: ["@google-cloud/storage", "unpdf"],
};

export default nextConfig;
