import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Silence the multi-lockfile workspace-root warning in the monorepo.
  turbopack: {
    root: path.resolve(__dirname),
  },
  async rewrites() {
    const backend = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3849";
    return [
      {
        source: "/api/:path*",
        destination: `${backend}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
