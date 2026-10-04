import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow local dashboard access via 127.0.0.1 in addition to localhost
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
