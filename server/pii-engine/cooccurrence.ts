/**
 * Criterion 2 support — an asset-scoped pass that looks for quasi-identifier
 * combinations across the attributes of a SINGLE asset (e.g. date of birth +
 * nationality + gender) and writes cooccurrence_findings. Runs AFTER the
 * per-attribute layers because Indirect Identification is contextual.
 *
 * Skeleton logic is deterministic (keyword match to the demographic quasi-id
 * classes) so it works offline; when the AI endpoint is configured it can be
 * extended to call the `cooccurrence_assess` prompt for a richer label/score.
 */
import { eq } from "drizzle-orm";
import { db } from "../db";
import { assets, attributes, cooccurrenceFindings } from "@shared/models/schema";
import { getSetting } from "../reference-cache";
import { matchByKeywords } from "./match";

// Quasi-identifier data classes that, in combination, enable re-identification.
const QUASI_CLASS_CODES = new Set(["DATE_OF_BIRTH", "NATIONALITY", "GENDER"]);

export async function runCooccurrence(runId: string): Promise<number> {
  const minQuasi = getSetting<number>("cooccurrence_min_quasi_identifiers") ?? 2;

  const assetRows = await db.select().from(assets);
  let written = 0;

  for (const asset of assetRows) {
    const attrRows = await db
      .select()
      .from(attributes)
      .where(eq(attributes.assetId, asset.id));

    const quasi = attrRows.filter((attr) => {
      const haystack = [attr.columnName, attr.descriptionEn, attr.piiName]
        .filter(Boolean)
        .join(" ");
      const match = matchByKeywords(haystack);
      return match ? QUASI_CLASS_CODES.has(match.dataClass.code) : false;
    });

    if (quasi.length < minQuasi) continue;

    const combinationLabel = quasi.map((a) => a.columnName).join(" + ");
    const riskScore = Math.min(0.4 + 0.2 * quasi.length, 1);

    await db.insert(cooccurrenceFindings).values({
      assetId: asset.id,
      attributeIds: quasi.map((a) => a.id),
      combinationLabel,
      riskScore,
      rationale: `Attributes [${combinationLabel}] together form a quasi-identifier that may single out an individual (Criterion 2 — Indirect Identifier).`,
      runId,
    });
    written++;
  }

  return written;
}
