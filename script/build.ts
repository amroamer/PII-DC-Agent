/**
 * Production build: vite builds the client -> dist/public, then esbuild bundles the
 * server -> dist/index.cjs. Our own code (relative imports + the @shared alias) is
 * bundled; node_modules (incl. native deps) stay external and are installed in the
 * runtime image.
 */
import { build, type Plugin } from "esbuild";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Externalise every bare npm import EXCEPT our path aliases, which must be bundled.
// (Entry point + relative + absolute paths are always resolved/bundled normally.)
const externalizePackages: Plugin = {
  name: "externalize-packages",
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /.*/ }, (args) => {
      if (args.kind === "entry-point") return null;
      const p = args.path;
      if (p.startsWith(".") || p.startsWith("/") || path.isAbsolute(p)) return null;
      if (p.startsWith("@shared") || p.startsWith("@/")) return null;
      return { path: p, external: true };
    });
  },
};

async function main() {
  // 1) Client
  const vite = spawnSync("npx", ["vite", "build"], {
    stdio: "inherit",
    cwd: rootDir,
    shell: true,
  });
  if (vite.status !== 0) process.exit(vite.status ?? 1);

  // 2) Server
  await build({
    entryPoints: [path.join(rootDir, "server", "index.ts")],
    outfile: path.join(rootDir, "dist", "index.cjs"),
    platform: "node",
    target: "node20",
    format: "cjs",
    bundle: true,
    sourcemap: true,
    logLevel: "info",
    tsconfig: path.join(rootDir, "tsconfig.json"),
    plugins: [externalizePackages],
  });

  // eslint-disable-next-line no-console
  console.log("\n✓ Build complete → dist/public (client) + dist/index.cjs (server)");
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
