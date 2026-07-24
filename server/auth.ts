/**
 * Session + passport-local authentication. Password hashing uses Node's scrypt
 * (no native bcrypt dependency). setupAuth() wires session middleware, the local
 * strategy, and the /api/auth/* route surface.
 */
import type { Express } from "express";
import session from "express-session";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { users, loginSchema, type User } from "@shared/models/schema";
import { asyncHandler, HttpError } from "./http";

const scryptAsync = promisify(scrypt);

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${derived.toString("hex")}.${salt}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [hashHex, salt] = stored.split(".");
  if (!hashHex || !salt) return false;
  const hashed = Buffer.from(hashHex, "hex");
  const supplied = (await scryptAsync(password, salt, 64)) as Buffer;
  return hashed.length === supplied.length && timingSafeEqual(hashed, supplied);
}

async function findUserByUsername(username: string): Promise<User | undefined> {
  const [row] = await db.select().from(users).where(eq(users.username, username)).limit(1);
  return row;
}

async function findUserById(id: number): Promise<User | undefined> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row;
}

// Only expose non-secret fields to the client.
function publicUser(user: User) {
  return { id: user.id, username: user.username, role: user.role };
}

export function setupAuth(app: Express): void {
  app.set("trust proxy", 1);
  app.use(
    session({
      secret: process.env.SESSION_SECRET ?? "dev-only-change-me",
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        // Secure by default in production, but overridable for HTTP-only deployments
        // (e.g. running the container behind a plain-HTTP host). Set COOKIE_SECURE=true
        // when serving over HTTPS / behind a TLS-terminating proxy.
        secure:
          process.env.COOKIE_SECURE !== undefined
            ? process.env.COOKIE_SECURE === "true"
            : process.env.NODE_ENV === "production",
        maxAge: 1000 * 60 * 60 * 8,
      },
    }),
  );

  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        const user = await findUserByUsername(username);
        if (!user || !(await verifyPassword(password, user.passwordHash))) {
          return done(null, false);
        }
        return done(null, user);
      } catch (err) {
        return done(err);
      }
    }),
  );

  passport.serializeUser((user, done) => done(null, (user as User).id));
  passport.deserializeUser(async (id: number, done) => {
    try {
      const user = await findUserById(id);
      done(null, user ?? false);
    } catch (err) {
      done(err);
    }
  });

  app.use(passport.initialize());
  app.use(passport.session());

  app.post(
    "/api/auth/login",
    asyncHandler(async (req, res, next) => {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) throw new HttpError(400, "Username and password are required.");
      passport.authenticate("local", (err: unknown, user: User | false) => {
        if (err) return next(err);
        if (!user) return next(new HttpError(401, "Invalid username or password."));
        req.logIn(user, (loginErr) => {
          if (loginErr) return next(loginErr);
          res.json({ user: publicUser(user) });
        });
      })(req, res, next);
    }),
  );

  app.post("/api/auth/logout", (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      res.json({ ok: true });
    });
  });

  app.get("/api/auth/me", (req, res) => {
    if (!req.isAuthenticated?.()) {
      res.status(401).json({ user: null });
      return;
    }
    res.json({ user: publicUser(req.user as User) });
  });
}
