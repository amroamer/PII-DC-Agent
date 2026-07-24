/**
 * One Express server serves BOTH the API and the SPA.
 *  - dev  : attach Vite as connect middleware (HMR); SPA falls through to Vite.
 *  - prod : serve the built client from dist/public.
 *
 * `vite` is imported dynamically so the production bundle never requires the dev
 * dependency (it is not installed in the runtime image).
 */
import express, { type Express } from "express";
import type { Server } from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// In dev (tsx/ESM) import.meta.url resolves to server/vite.ts -> project root.
// In the bundled prod CJS (dist/index.cjs) it resolves to /app/dist -> /app.
// Fall back to cwd if import.meta.url is unavailable.
const rootDir = (() => {
  try {
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  } catch {
    return process.cwd();
  }
})();
const BASE = "/pdtc/";

export function log(message: string): void {
  const time = new Date().toLocaleTimeString();
  // eslint-disable-next-line no-console
  console.log(`${time} [pdtc] ${message}`);
}

export async function setupVite(app: Express, server: Server): Promise<void> {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    configFile: path.resolve(rootDir, "vite.config.ts"),
    appType: "custom",
    server: { middlewareMode: true, hmr: { server } },
  });

  app.use(vite.middlewares);

  // SPA fallback for any non-API GET: hand back the transformed index.html.
  app.get(/^\/(?!api\/).*/, async (req, res, next) => {
    try {
      const templatePath = path.resolve(rootDir, "client", "index.html");
      const template = await vite.transformIndexHtml(
        req.originalUrl,
        await fs.promises.readFile(templatePath, "utf-8"),
      );
      res.status(200).set({ "Content-Type": "text/html" }).end(template);
    } catch (err) {
      vite.ssrFixStacktrace(err as Error);
      next(err);
    }
  });

  log("vite middleware attached (dev)");
}

export function serveStatic(app: Express): void {
  const distPath = path.resolve(rootDir, "dist", "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Build output not found at ${distPath}. Run "npm run build" before starting in production.`,
    );
  }

  app.use(BASE, express.static(distPath, { index: false }));

  // Client-side routes under the base all resolve to index.html.
  app.get(/^\/pdtc(?:\/.*)?$/, (_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });

  // Bare root -> app base.
  app.get("/", (_req, res) => res.redirect(BASE));

  log("serving static client from dist/public (prod)");
}
