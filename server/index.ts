import express, { type Request, type Response, type NextFunction } from "express";
import { registerRoutes } from "./routes";
import { log } from "./vite";

async function main(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: false }));

  // Registers seeds -> auth -> feature routes -> vite/static, returns the http server.
  const server = await registerRoutes(app);

  // Error-handling middleware LAST: thrown errors -> JSON { message }.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err?.status ?? err?.statusCode ?? 500;
    const message = err?.message ?? "Internal Server Error";
    if (status >= 500) {
      // eslint-disable-next-line no-console
      console.error(err);
    }
    res.status(status).json({ message });
  });

  const port = Number(process.env.PORT) || 5000;
  server.listen(port, () => log(`PDTC listening on http://localhost:${port}/pdtc/`));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fatal startup error:", err);
  process.exit(1);
});
