/**
 * Signal fusion. Applies layer precedence + confidence combination, and — crucially
 * — flags CONFLICTS. When layers disagree the engine never silently picks a winner:
 * the item is written with verdict 'uncertain' and forced into the review queue at
 * high priority (see server/review/build.ts).
 */
import type { DetectionSignal } from "./types";
import type {
  Detection,
  DetectionLayer,
  DetectionVerdict,
} from "@shared/models/schema";
import type { CriterionCode } from "@shared/lib/criteria";
import { isCriterionCode } from "@shared/lib/criteria";

export interface MergedDecision {
  verdict: DetectionVerdict;
  criterion: CriterionCode | null;
  dataClassCode: string | null;
  confidence: number;
  rationaleEn: string;
  rationaleAr: string;
  conflict: boolean;
  contributingLayers: DetectionLayer[];
  nearThreshold: boolean;
}

const STRONG = 0.5;

function highestConfidence(signals: DetectionSignal[]): DetectionSignal {
  return signals.reduce((best, s) => (s.confidence > best.confidence ? s : best));
}

const clamp = (n: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));

export function mergeSignals(
  signals: DetectionSignal[],
  threshold = 0.6,
): MergedDecision {
  const present = signals.filter(Boolean);
  if (present.length === 0) {
    return {
      verdict: "not_pii",
      criterion: null,
      dataClassCode: null,
      confidence: 0,
      rationaleEn: "No detection signal was produced for this attribute.",
      rationaleAr: "لم يتم إنتاج أي إشارة كشف لهذه السمة.",
      conflict: false,
      contributingLayers: [],
      nearThreshold: false,
    };
  }

  const piiSignals = present.filter((s) => s.verdict === "pii");
  const notPiiSignals = present.filter((s) => s.verdict === "not_pii");
  const conflict =
    piiSignals.some((s) => s.confidence >= STRONG) &&
    notPiiSignals.some((s) => s.confidence >= STRONG);

  let winner: DetectionSignal;
  let verdict: DetectionVerdict;

  if (conflict) {
    winner = highestConfidence(present);
    verdict = "uncertain";
  } else if (piiSignals.length > 0) {
    winner = highestConfidence(piiSignals);
    verdict = "pii";
  } else if (notPiiSignals.length > 0) {
    winner = highestConfidence(notPiiSignals);
    verdict = "not_pii";
  } else {
    winner = highestConfidence(present);
    verdict = "uncertain";
  }

  const agreement = present.filter((s) => s.verdict === verdict).length;
  const confidence = clamp(winner.confidence + (agreement - 1) * 0.08);
  const nearThreshold = verdict === "pii" && Math.abs(confidence - threshold) <= 0.1;

  return {
    verdict,
    criterion: winner.criterion,
    dataClassCode: winner.dataClassCode,
    confidence,
    rationaleEn: conflict
      ? `Detection layers disagreed (${present.map((s) => `${s.layer}=${s.verdict}`).join(", ")}); flagged uncertain for steward review.`
      : winner.rationaleEn,
    rationaleAr: conflict
      ? "اختلفت طبقات الكشف في التقييم؛ تم وضع علامة \"غير مؤكد\" لمراجعة أمين البيانات."
      : winner.rationaleAr,
    conflict,
    contributingLayers: present.map((s) => s.layer),
    nearThreshold,
  };
}

/** Reconstruct a signal from a persisted detection row (for read-side merging). */
export function detectionToSignal(row: Detection): DetectionSignal {
  const evidence = (row.evidence ?? {}) as Record<string, unknown>;
  return {
    layer: row.layer,
    verdict: row.verdict,
    criterion: isCriterionCode(row.criterionCode) ? row.criterionCode : null,
    dataClassCode: row.dataClassCode ?? null,
    confidence: row.confidence,
    rationaleEn: row.rationaleEn ?? "",
    rationaleAr: row.rationaleAr ?? "",
    signals: Array.isArray(evidence.signals) ? (evidence.signals as string[]) : [],
    evidence,
  };
}
