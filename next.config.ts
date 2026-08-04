import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The repo root is the workspace root; without this, Next walks up past the
  // git root looking for a lockfile.
  turbopack: { root: __dirname },
};

export default nextConfig;
