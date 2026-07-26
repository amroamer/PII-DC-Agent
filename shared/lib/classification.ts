/**
 * DGE Whole-of-Government Data Classification Framework v1.0 (PL-IMS-003, §8.2)
 * confidentiality scale + the rollup precedence rule. Defined ONCE and shared by
 * client and server so an asset's rolled-up label is computed the same way in the
 * engine and displayed the same way in the UI.
 *
 * The four levels, from least to most restrictive, are Open → Confidential →
 * Sensitive → Secret. Confidential is the framework's DEFAULT level for all data
 * (§8.2: "Set confidential as the default classification level for all data").
 *
 * `rank` drives the high-water-mark rollup: an asset inherits the MAX rank among
 * its attributes' levels. Higher rank == more restrictive.
 */

export const CLASSIFICATION_CODES = [
  "OPEN",
  "CONFIDENTIAL",
  "SENSITIVE",
  "SECRET",
] as const;

export type ClassificationCode = (typeof CLASSIFICATION_CODES)[number];

export interface ClassificationLevelDef {
  code: ClassificationCode;
  labelEn: string;
  labelAr: string;
  rank: number;
  /** design-token key consumed by <ClassificationBadge> */
  colorToken: string;
}

export const CLASSIFICATION_LEVELS: Record<ClassificationCode, ClassificationLevelDef> = {
  OPEN: {
    code: "OPEN",
    labelEn: "Open",
    labelAr: "مفتوح",
    rank: 0,
    colorToken: "success",
  },
  CONFIDENTIAL: {
    code: "CONFIDENTIAL",
    labelEn: "Confidential",
    labelAr: "سري",
    rank: 1,
    colorToken: "info",
  },
  SENSITIVE: {
    code: "SENSITIVE",
    labelEn: "Sensitive",
    labelAr: "حساس",
    rank: 2,
    colorToken: "warning",
  },
  SECRET: {
    code: "SECRET",
    labelEn: "Secret",
    labelAr: "سري للغاية",
    rank: 3,
    colorToken: "destructive",
  },
};

export const CLASSIFICATION_LEVELS_LIST: ClassificationLevelDef[] = CLASSIFICATION_CODES.map(
  (code) => CLASSIFICATION_LEVELS[code],
);

/** The framework's default classification for all data (§8.2). */
export const DEFAULT_CLASSIFICATION_CODE: ClassificationCode = "CONFIDENTIAL";

export function isClassificationCode(value: unknown): value is ClassificationCode {
  return (
    typeof value === "string" && (CLASSIFICATION_CODES as readonly string[]).includes(value)
  );
}

export function levelRank(code: ClassificationCode): number {
  return CLASSIFICATION_LEVELS[code].rank;
}

export function levelLabel(code: ClassificationCode, lang: "en" | "ar" = "en"): string {
  const def = CLASSIFICATION_LEVELS[code];
  return lang === "ar" ? def.labelAr : def.labelEn;
}

/**
 * High-water-mark rollup. Returns the most restrictive (highest-rank) code among
 * the inputs. Ties resolve to the more restrictive label (identical ranks are the
 * same code, so this only matters if the scale is ever extended with equal ranks —
 * in which case the LATER, more restrictive entry wins). Returns null for no input.
 */
export function rollupLevel(codes: ClassificationCode[]): ClassificationCode | null {
  if (codes.length === 0) return null;
  return codes.reduce((winner, candidate) => {
    if (levelRank(candidate) >= levelRank(winner)) return candidate;
    return winner;
  });
}

/** The more restrictive of two levels (used when reconciling override vs rollup). */
export function moreRestrictive(
  a: ClassificationCode,
  b: ClassificationCode,
): ClassificationCode {
  return levelRank(a) >= levelRank(b) ? a : b;
}
