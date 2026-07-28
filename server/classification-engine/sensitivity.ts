/**
 * Deterministic sensitivity floor — DGE WoG Data Classification Framework v1.0 §8.2.
 *
 * The AI classifier (classify-infer) handles nuanced, context-driven impact, but it is
 * escalate-only and degrades to null when the AI endpoint is unavailable (or simply misses).
 * That left two framework categories under-classified at the CONFIDENTIAL rule floor:
 *
 *   - Gap #1 — NON-personal sensitive data. §8.2 puts trade secrets, source code, proprietary
 *     algorithms, design schematics/blueprints, investment/legal strategies, and security
 *     configurations/vulnerabilities at SENSITIVE. The app previously classified these as
 *     CONFIDENTIAL because SENSITIVE was scoped to special-category personal data only.
 *   - Gap #2 — SECRET was almost never assigned deterministically. §8.2 reserves SECRET for
 *     data whose disclosure causes severe harm: access credentials, and classified / national
 *     security / defence / intelligence content.
 *
 * This keyword floor is the deterministic backstop: it raises a column whose NAME or DESCRIPTION
 * clearly matches a Sensitive/Secret §8.2 category, so the level is correct even with the AI
 * offline. It reads ONLY the column name + description (not the asset context) so operational /
 * system columns are never over-classified merely for sitting inside a sensitive table — the
 * asset-context nuance stays with the AI layer, which the prompt already handles.
 *
 * It is a FLOOR: it can only raise a level, never lower one. The AI may still escalate further.
 */
import type { ClassificationCode } from "@shared/lib/classification";

export interface SensitivityInput {
  columnName: string;
  descriptionEn?: string | null;
}

/**
 * SECRET (§8.2: severe adverse effects). Reserved for the national-security tier: access
 * credentials that grant system entry, and explicit classified / national-security / defence /
 * intelligence markers. Ordinary law-enforcement/investigative data floors at SENSITIVE below —
 * the AI classifier still escalates a person-under-investigation to SECRET per its prompt.
 */
const SECRET_RE =
  /(password|passwd|\bpwd\b|password[ _]?answer|password[ _]?question|password[ _]?salt|[ _]salt\b|secret[ _]?key|private[ _]?key|api[ _]?key|encryption[ _]?key|access[ _]?token|refresh[ _]?token|classified|top[ _]?secret|state[ _]?secret|national[ _]?security|intelligence[ _]?report|defe[nc]se[ _]?plan|national[ _]?defe)/i;

/**
 * SENSITIVE (§8.2). Special-category personal data (health/biometric/religion/ethnicity/genetic)
 * AND non-personal sensitive: trade secrets, source code, proprietary algorithms, design
 * schematics/blueprints, investment/legal strategies, security configurations/vulnerabilities,
 * and law-enforcement content (seizure/smuggling/contraband/narcotics/investigation, and a
 * person under investigation: offender/suspect/informant/blacklist/watchlist).
 * Note "disabilit" matches "disability" (health) but not "is_disabled" (an operational flag).
 */
const SENSITIVE_RE =
  /(health|illness|medical|disease|disabilit|diagnos|patient|clinic|blood[ _]?type|biometric|finger[ _]?print|\bphoto|[ _]photo|iris[ _]|retina|facial|religio|faith|ethnic|racial|genetic|trade[ _]?secret|source[ _]?code|proprietary|algorithm|blueprint|schematic|investment[ _]?strateg|legal[ _]?strateg|litigation|case[ _]?strateg|vulnerabilit|pen[ _]?test|security[ _]?config|firewall[ _]?rule|seizure|seized|smuggl|contraband|narcotic|investigation|penalty|offender|suspect|informant|black[ _]?list|watch[ _]?list)/i;

/**
 * The framework floor for a column, or null when nothing clearly matches. SECRET wins over
 * SENSITIVE. The caller reconciles this with the rule floor and the AI level (moreRestrictive).
 */
export function sensitivityFloor(input: SensitivityInput): ClassificationCode | null {
  const hay = `${input.columnName ?? ""} ${input.descriptionEn ?? ""}`.toLowerCase();
  if (SECRET_RE.test(hay)) return "SECRET";
  if (SENSITIVE_RE.test(hay)) return "SENSITIVE";
  return null;
}
