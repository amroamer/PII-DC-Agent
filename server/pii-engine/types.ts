import type { Attribute } from "@shared/models/schema";
import type { CriterionCode } from "@shared/lib/criteria";
import type { DetectionLayer, DetectionVerdict } from "@shared/models/schema";

/** Minimal parent-asset context a layer is allowed to see (metadata only). */
export interface AssetContext {
  id: number;
  name: string;
  assetType: string | null;
  businessDomain: string | null;
  subjectArea: string | null;
}

export interface DetectionInput {
  attribute: Attribute;
  asset: AssetContext;
  siblingColumnNames: string[];
}

export interface DetectionSignal {
  layer: DetectionLayer;
  verdict: DetectionVerdict;
  criterion: CriterionCode | null;
  dataClassCode: string | null;
  confidence: number;
  rationaleEn: string;
  rationaleAr: string;
  signals: string[];
  evidence?: Record<string, unknown>;
}

export interface EngineContext {
  runId: string;
  engineVersion: string;
  useLlmLayer: boolean;
  confidenceReviewThreshold: number;
}
