/**
 * Append-only decision log. This is the ONLY writer to audit_log, and it only
 * ever INSERTs — there is no UPDATE or DELETE path against audit_log anywhere in
 * the codebase. Every accept / reject / override / classification write records a
 * before + after + rationale here.
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { auditLog, type AuditEntry, type AuditSource } from "@shared/models/schema";

export interface AuditInput {
  actorId?: number | null;
  action: string;
  entityType: string;
  entityId: string | number;
  before?: unknown;
  after?: unknown;
  rationale?: string | null;
  /** Provenance of the change (Prompt 2 §11). Defaults to 'system'. */
  source?: AuditSource;
  runId?: number | null;
  importBatchId?: number | null;
}

export async function appendAudit(input: AuditInput): Promise<AuditEntry> {
  const [row] = await db
    .insert(auditLog)
    .values({
      actorId: input.actorId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: String(input.entityId),
      before: (input.before ?? null) as AuditEntry["before"],
      after: (input.after ?? null) as AuditEntry["after"],
      rationale: input.rationale ?? null,
      source: input.source ?? "system",
      runId: input.runId ?? null,
      importBatchId: input.importBatchId ?? null,
    })
    .returning();
  return row;
}

export async function listAudit(entityType?: string, entityId?: string): Promise<AuditEntry[]> {
  if (entityType && entityId) {
    return db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityType, entityType), eq(auditLog.entityId, entityId)))
      .orderBy(desc(auditLog.createdAt));
  }
  return db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(200);
}
