import type { Request, Response, NextFunction, RequestHandler } from "express";

/** An error carrying an HTTP status. The index.ts error handler reads `.status`. */
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "HttpError";
  }
}

export const badRequest = (msg: string) => new HttpError(400, msg);
export const unauthorized = (msg = "Not authenticated") => new HttpError(401, msg);
export const forbidden = (msg = "Admin role required") => new HttpError(403, msg);
export const notFound = (msg = "Not found") => new HttpError(404, msg);

/** Wrap an async route so thrown/rejected errors reach the error middleware. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/** Gate a route behind an authenticated passport session. */
export const requireAuth: RequestHandler = (req, res, next) => {
  if (req.isAuthenticated?.()) return next();
  next(unauthorized());
};

/** Gate a route behind an authenticated session with the admin role. */
export const requireAdmin: RequestHandler = (req, res, next) => {
  if (!req.isAuthenticated?.()) return next(unauthorized());
  if ((req.user as { role?: string } | undefined)?.role !== "admin") return next(forbidden());
  next();
};
