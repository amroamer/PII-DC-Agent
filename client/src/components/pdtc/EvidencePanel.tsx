import { useLanguage } from "@/hooks/useLanguage";
import { CriterionBadge } from "./CriterionBadge";
import { VerdictPill } from "./Pill";
import { ConfidenceBar } from "./ConfidenceBar";
import { Separator } from "@/components/ui/separator";
import { isCriterionCode } from "@shared/lib/criteria";

interface EvidenceDetection {
  id: number;
  layer: string;
  verdict: "pii" | "not_pii" | "uncertain";
  criterionCode: string | null;
  dataClassCode: string | null;
  confidence: number;
  rationaleEn: string | null;
  rationaleAr: string | null;
  evidence: Record<string, unknown> | null;
}

interface EvidenceAttribute {
  columnName: string;
  descriptionEn: string | null;
  descriptionAr: string | null;
  dataType: string | null;
}

export interface EvidencePayload {
  detection: EvidenceDetection;
  attribute?: EvidenceAttribute;
  asset?: { name: string; businessDomain: string | null } | null;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2 py-1 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="col-span-2 break-words">{value ?? "—"}</dd>
    </div>
  );
}

export function EvidencePanel({ payload }: { payload: EvidencePayload }) {
  const { lang } = useLanguage();
  const { detection, attribute, asset } = payload;
  const rationale = lang === "ar" ? detection.rationaleAr : detection.rationaleEn;
  const signals = Array.isArray(detection.evidence?.signals)
    ? (detection.evidence?.signals as string[])
    : [];

  return (
    <div className="space-y-4">
      <section>
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {lang === "ar" ? "الوصف الوصفي" : "Metadata"}
        </h4>
        <dl className="divide-y">
          <Field label={lang === "ar" ? "العمود" : "Column"} value={attribute?.columnName} />
          <Field label={lang === "ar" ? "الوصف" : "Description"} value={attribute?.descriptionEn} />
          <Field label={lang === "ar" ? "الوصف بالعربية" : "Description (AR)"} value={attribute?.descriptionAr} />
          <Field label={lang === "ar" ? "نوع البيانات" : "Data type"} value={attribute?.dataType} />
          <Field label={lang === "ar" ? "الأصل" : "Asset"} value={asset?.name} />
          <Field label={lang === "ar" ? "المجال" : "Domain"} value={asset?.businessDomain} />
        </dl>
      </section>

      <Separator />

      <section className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {lang === "ar" ? "قرار الكشف" : "Detection verdict"}
        </h4>
        <div className="flex flex-wrap items-center gap-2">
          <VerdictPill verdict={detection.verdict} />
          {isCriterionCode(detection.criterionCode) && <CriterionBadge code={detection.criterionCode} />}
          <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            {detection.layer}
          </span>
        </div>
        <ConfidenceBar value={detection.confidence} />
        {detection.dataClassCode && (
          <p className="text-xs text-muted-foreground">
            {lang === "ar" ? "فئة البيانات" : "Data class"}: {detection.dataClassCode}
          </p>
        )}
        {rationale && <p className="text-sm">{rationale}</p>}
      </section>

      {signals.length > 0 && (
        <section>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {lang === "ar" ? "الإشارات" : "Signals"}
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {signals.map((signal) => (
              <span key={signal} className="rounded bg-secondary px-1.5 py-0.5 text-xs">
                {signal}
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
