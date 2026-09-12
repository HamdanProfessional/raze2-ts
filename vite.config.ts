import { defineConfig } from "vite";
import { resolve } from "path";
import { execSync } from "node:child_process";

/**
 * Stamp appended to every asset URL as `?v=` (see ASSET_V in src/core/Config).
 *
 * Asset paths are stable by design, so without this a re-baked sheet stays
 * hidden behind a CDN/browser cache long after it ships.
 *
 * This is the git TREE hash of public/assets, not the commit hash: it changes
 * when and only when an asset actually changes. Keying on the commit would
 * hand every code-only deploy a fresh URL for all 140 MB of unchanged art and
 * make clients re-download the lot.
 */
function assetVersion(): string {
  try {
    return execSync("git rev-parse HEAD:public/assets", { encoding: "utf8" })
      .trim().slice(0, 12);
  } catch {
    // No git (or assets not committed yet) -- fall back to something that at
    // least changes per build rather than silently pinning a stale version.
    return String(Date.now());
  }
}

export default defineConfig({
  define: {
    __ASSET_V__: JSON.stringify(assetVersion()),
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5173,
    open: true,
  },
  build: {
    target: "es2022",
    outDir: "dist",
  },
});
