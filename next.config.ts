import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * The standalone bundle is only for the Docker runner stage; `next start`
   * warns and misbehaves when the build produced one. Gating it on an env var
   * keeps local `npm start` normal and lets the Dockerfile opt in.
   */
  ...(process.env.BUILD_STANDALONE === "true" ? { output: "standalone" as const } : {}),
  /*
   * PGlite ships a WASM data file it opens by path at runtime. Bundling the
   * package into the server build breaks that lookup (it resolves against the
   * build output instead of node_modules), so every page that reads the
   * portfolio 500s. Keeping it external is the supported fix; the real-Postgres
   * driver is unaffected either way.
   */
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
