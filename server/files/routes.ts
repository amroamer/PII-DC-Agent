/**
 * Simple durable file store for the "Import Test" page. File bytes are held in
 * Postgres (stored_files.content bytea) so they persist across redeploys — no
 * dependency on container disk. Supports multi-upload, search, single + zip
 * download, and delete.
 */
import type { Express } from "express";
import multer from "multer";
import JSZip from "jszip";
import { desc, eq, ilike, inArray } from "drizzle-orm";
import { db } from "../db";
import { storedFiles, type User } from "@shared/models/schema";
import { asyncHandler, HttpError, requireAuth } from "../http";
import { UPLOAD_MAX_BYTES } from "../ingest/routes";

/**
 * Shares the IKC ingest ceiling (200 MB) so the two upload paths cannot drift,
 * and so both stay tied to the nginx `client_max_body_size` that fronts them —
 * a limit raised here but not there fails at the proxy with an opaque 413.
 *
 * NOTE: multer buffers into memory, so `files` x `fileSize` is the worst-case
 * RSS for one request. 20 x 200 MB is deliberately generous for a test-import
 * screen; lower `files` if this ever runs somewhere memory-constrained.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD_MAX_BYTES, files: 20 },
});

// Metadata columns only — never load the bytea content into a list query.
const META = {
  id: storedFiles.id,
  filename: storedFiles.filename,
  mimeType: storedFiles.mimeType,
  size: storedFiles.size,
  createdAt: storedFiles.createdAt,
};

export function registerFileRoutes(app: Express): void {
  // List (with optional filename search).
  app.get(
    "/api/files",
    requireAuth,
    asyncHandler(async (req, res) => {
      const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
      const rows = await db
        .select(META)
        .from(storedFiles)
        .where(search ? ilike(storedFiles.filename, `%${search}%`) : undefined)
        .orderBy(desc(storedFiles.id));
      res.json(rows);
    }),
  );

  // Upload one or more files (form field: files).
  app.post(
    "/api/files",
    requireAuth,
    upload.array("files", 20),
    asyncHandler(async (req, res) => {
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      if (files.length === 0) throw new HttpError(400, "No files uploaded (form field name: files).");
      const uploadedBy = (req.user as User | undefined)?.id ?? null;

      const inserted = [];
      for (const f of files) {
        const [row] = await db
          .insert(storedFiles)
          .values({
            filename: f.originalname,
            mimeType: f.mimetype,
            size: f.size,
            content: f.buffer,
            uploadedBy: uploadedBy ?? undefined,
          })
          .returning(META);
        inserted.push(row);
      }
      res.json({ uploaded: inserted.length, files: inserted });
    }),
  );

  // Download a single file.
  app.get(
    "/api/files/:id/download",
    requireAuth,
    asyncHandler(async (req, res) => {
      const [row] = await db.select().from(storedFiles).where(eq(storedFiles.id, Number(String(req.params.id)))).limit(1);
      if (!row) throw new HttpError(404, "File not found.");
      res.setHeader("Content-Type", row.mimeType ?? "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(row.filename)}"`);
      res.send(row.content);
    }),
  );

  // Download several files bundled into a zip.
  app.post(
    "/api/files/download-zip",
    requireAuth,
    asyncHandler(async (req, res) => {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter((n: number) => !Number.isNaN(n)) : [];
      if (ids.length === 0) throw new HttpError(400, "Provide an array of file ids.");
      const rows = await db.select().from(storedFiles).where(inArray(storedFiles.id, ids));

      const zip = new JSZip();
      const used = new Map<string, number>();
      for (const r of rows) {
        // De-duplicate identical filenames inside the archive.
        let name = r.filename;
        if (used.has(name)) {
          const n = (used.get(name) ?? 0) + 1;
          used.set(name, n);
          const dot = name.lastIndexOf(".");
          name = dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
        } else {
          used.set(name, 0);
        }
        zip.file(name, r.content);
      }
      const buffer = await zip.generateAsync({ type: "nodebuffer" });
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="pdtc-files.zip"`);
      res.send(buffer);
    }),
  );

  // Delete a file.
  app.delete(
    "/api/files/:id",
    requireAuth,
    asyncHandler(async (req, res) => {
      await db.delete(storedFiles).where(eq(storedFiles.id, Number(String(req.params.id))));
      res.json({ ok: true });
    }),
  );
}
