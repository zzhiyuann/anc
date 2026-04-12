import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Silence the multi-lockfile workspace-root warning in the monorepo.
  turbopack: {
    root: path.resolve(__dirname),
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:3848/api/:path*",
      },
    ];
  },
};

export default nextConfig;
