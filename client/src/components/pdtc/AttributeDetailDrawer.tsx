import { useQuery } from "@tanstack/react-query";
import { Drawer } from "./Drawer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ClassificationBadge } from "./ClassificationBadge";
import { CriterionBadge } from "./CriterionBadge";
import { VerdictPill } from "./Pill";
import { ConfidenceBar } from "./ConfidenceBar";
import { useLanguage } from "@/hooks/useLanguage";
import { Section, FieldList, Field, RawRow, AuditList, type AuditEntryView } from "./detail-parts";
import { isCriterionCode } from "@shared/lib/criteria";
import type { DetectionVerdict } from "@shared/models/schema";

interface AttributeDetail {
  attribute: Record<string, any>;
  asset: { id: number; name: string; businessDomain: string[] | null } | null;
  detection: {
    runId: string | null;
    merged: null | {
      verdict: DetectionVerdict;
      criterion: string | null;
      confidence: number;
      conflict: boolean;
      contributingLayers: string[];
      rationaleEn: string;
      rationaleAr: string;
      dataClassCode: string | null;
    };
    layers: Array<Record<string, any>>;
  };
  assessments: Array<{ criterionCode: string; applies: boolean; confidence: number }>;
  classification: { active: Record<string, any> | null; history: Array<Record<string, any>> };
  metadata: { fields: Array<{ key: string; labelEn: string; labelAr: string; providedBy: string; present: boolean }> };
  reviews: Array<Record<string, any>>;
  cooccurrence: Array<{ id: number; combinationLabel: string; riskScore: number; rationale: string | null }>;
  audit: AuditEntryView[];
}

export function AttributeDetailDrawer({
  id,
  defaultTab = "overview",
  onClose,
}: {
  id: number | null;
  defaultTab?: string;
  onClose: () => void;
}) {
  const { lang } = useLanguage();
  const { data: d } = useQuery<AttributeDetail>({ queryKey: [`/api/catalog/attributes/${id}`], enabled: id !== null });
  const a: any = d?.attribute;
  const yn = (v: boolean) => (v ? (lang === "ar" ? "نعم" : "Yes") : (lang === "ar" ? "لا" : "No"));

  return (
    <Drawer
      open={id !== null}
      onOpenChange={(o) => !o && onClose()}
      className="max-w-2xl"
      title={a?.columnName ?? (lang === "ar" ? "سمة" : "Attribute")}
      description={d?.asset?.name}
    >
      {!d ? (
        <p className="text-sm text-muted-foreground">{lang === "ar" ? "جارٍ التحميل…" : "Loading…"}</p>
      ) : (
        <Tabs defaultValue={defaultTab} className="space-y-4">
          <TabsList className="flex flex-wrap">
            <TabsTrigger value="overview">{lang === "ar" ? "نظرة عامة" : "Overview"}</TabsTrigger>
            <TabsTrigger value="pii">{lang === "ar" ? "الكشف" : "PII detection"}</TabsTrigger>
            <TabsTrigger value="classification">{lang === "ar" ? "التصنيف" : "Classification"}</TabsTrigger>
            <TabsTrigger value="review">{lang === "ar" ? "المراجعة" : "Review"}{d.reviews.length ? ` (${d.reviews.length})` : ""}</TabsTrigger>
            <TabsTrigger value="provenance">{lang === "ar" ? "الأثر" : "Provenance"}</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <Section title={lang === "ar" ? "التعريف" : "Identity"}>
              <FieldList>
                <Field label={lang === "ar" ? "العمود" : "Column"}>{a.columnName}</Field>
                <Field label={lang === "ar" ? "الأصل" : "Asset"}>{d.asset?.name}</Field>
                <Field label={lang === "ar" ? "المجال" : "Domain"}>{(d.asset?.businessDomain ?? []).join(", ")}</Field>
                <Field label={lang === "ar" ? "الوصف (EN)" : "Description (EN)"}>{a.descriptionEn}</Field>
                <Field label={lang === "ar" ? "الوصف (AR)" : "Description (AR)"}>{a.descriptionAr}</Field>
              </FieldList>
            </Section>
            <Section title={lang === "ar" ? "النوع" : "Type"}>
              <FieldList>
                <Field label={lang === "ar" ? "نوع البيانات" : "Data type"}>{a.dataType}</Field>
                <Field label={lang === "ar" ? "النوع الأصلي" : "Native type"}>{a.nativeType}</Field>
                <Field label={lang === "ar" ? "مفتاح رئيسي" : "Primary key"}>{yn(a.isPrimaryKey)}</Field>
                <Field label={lang === "ar" ? "يقبل الفراغ" : "Nullable"}>{yn(a.nullable)}</Field>
                <Field label={lang === "ar" ? "الطول" : "Length"}>{a.length}</Field>
                <Field label={lang === "ar" ? "المقياس" : "Scale"}>{a.scale}</Field>
                <Field label={lang === "ar" ? "الجودة" : "Quality"}>{a.qualityScore}</Field>
              </FieldList>
            </Section>
            <Section title={lang === "ar" ? "الأعمال" : "Business"}>
              <FieldList>
                <Field label={lang === "ar" ? "فئة البيانات المختارة" : "Selected data class"}>{a.selectedDataClassName}</Field>
                <Field label={lang === "ar" ? "ثقة الفئة" : "Class confidence"}>{a.selectedDataClassConfidence != null ? `${Math.round(a.selectedDataClassConfidence * 100)}%` : null}</Field>
                <Field label="PII name">{a.piiName}</Field>
                <Field label="PII description">{a.piiDescription}</Field>
                <Field label="CDE">{yn(a.cdeFlag)}</Field>
                <Field label={lang === "ar" ? "مصطلحات الأعمال" : "Business terms"}>{a.businessTerms?.join(", ")}</Field>
              </FieldList>
            </Section>
          </TabsContent>

          <TabsContent value="pii" className="space-y-4">
            {d.detection.merged ? (
              <Section title={lang === "ar" ? "القرار المدمج" : "Fused verdict"}>
                <FieldList>
                  <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <VerdictPill verdict={d.detection.merged.verdict} />
                    {isCriterionCode(d.detection.merged.criterion) && <CriterionBadge code={d.detection.merged.criterion} />}
                    <ConfidenceBar value={d.detection.merged.confidence} className="w-40" />
                    {d.detection.merged.conflict && <Badge variant="warning">{lang === "ar" ? "تعارض" : "conflict"}</Badge>}
                  </div>
                  <Field label={lang === "ar" ? "المبرر" : "Rationale"}>{lang === "ar" ? d.detection.merged.rationaleAr : d.detection.merged.rationaleEn}</Field>
                </FieldList>
              </Section>
            ) : (
              <p className="text-sm text-muted-foreground">{lang === "ar" ? "لم يُشغَّل الكشف على هذه السمة بعد." : "No detection has been run on this attribute yet."}</p>
            )}
            {d.detection.layers.length > 0 && (
              <Section title={lang === "ar" ? "طبقات الكشف" : "Detection layers"}>
                <FieldList>
                  {d.detection.layers.map((l) => (
                    <div key={l.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{l.layer}</span>
                      <VerdictPill verdict={l.verdict} />
                      {isCriterionCode(l.criterionCode) && <CriterionBadge code={l.criterionCode} />}
                      <ConfidenceBar value={l.confidence} className="w-28" />
                      {l.dataClassCode && <span className="text-xs text-muted-foreground">{l.dataClassCode}</span>}
                    </div>
                  ))}
                </FieldList>
              </Section>
            )}
            {d.assessments.length > 0 && (
              <Section title={lang === "ar" ? "تقييم المعايير" : "Criteria assessment"}>
                <FieldList>
                  {d.assessments.map((as) => (
                    <div key={as.criterionCode} className="flex items-center gap-2 px-3 py-2 text-sm">
                      {isCriterionCode(as.criterionCode) && <CriterionBadge code={as.criterionCode} />}
                      <Badge variant={as.applies ? "default" : "secondary"}>{as.applies ? (lang === "ar" ? "ينطبق" : "applies") : (lang === "ar" ? "لا" : "no")}</Badge>
                      <ConfidenceBar value={as.confidence} className="ms-auto w-28" />
                    </div>
                  ))}
                </FieldList>
              </Section>
            )}
            {d.cooccurrence.length > 0 && (
              <Section title={lang === "ar" ? "التواجد المشترك" : "Co-occurrence"}>
                <FieldList>
                  {d.cooccurrence.map((c) => (
                    <Field key={c.id} label={c.combinationLabel}>{`${Math.round(c.riskScore * 100)}% ${lang === "ar" ? "خطر" : "risk"}`}</Field>
                  ))}
                </FieldList>
              </Section>
            )}
          </TabsContent>

          <TabsContent value="classification" className="space-y-4">
            <Section title={lang === "ar" ? "التصنيف النشط" : "Active classification"}>
              <FieldList>
                <div className="flex items-center gap-2 px-3 py-2">
                  <ClassificationBadge code={d.classification.active?.levelCode ?? null} />
                  {d.classification.active && <Badge variant="secondary">{d.classification.active.derivedFrom}</Badge>}
                </div>
                <Field label={lang === "ar" ? "المبرر" : "Rationale"}>{d.classification.active?.rationale}</Field>
              </FieldList>
            </Section>
            <Section title={lang === "ar" ? "اكتمال البيانات الوصفية" : "Metadata completeness"}>
              <FieldList>
                {d.metadata.fields.map((f) => (
                  <div key={f.key} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span>{lang === "ar" ? f.labelAr : f.labelEn} <span className="text-xs text-muted-foreground">({f.providedBy})</span></span>
                    <span className={f.present ? "text-success" : "text-muted-foreground"}>{f.present ? "✓" : "—"}</span>
                  </div>
                ))}
              </FieldList>
            </Section>
            {d.classification.history.length > 1 && (
              <Section title={lang === "ar" ? "السجل" : "History"}>
                <FieldList>
                  {d.classification.history.map((h) => (
                    <div key={h.id} className="flex items-center justify-between px-3 py-2 text-sm">
                      <div className="flex items-center gap-2"><ClassificationBadge code={h.levelCode} /><span className="text-xs text-muted-foreground">{h.derivedFrom}</span></div>
                      <span className="text-xs text-muted-foreground">{h.supersededBy ? (lang === "ar" ? "متجاوَز" : "superseded") : (lang === "ar" ? "نشط" : "active")}</span>
                    </div>
                  ))}
                </FieldList>
              </Section>
            )}
          </TabsContent>

          <TabsContent value="review" className="space-y-4">
            {d.reviews.length === 0 ? (
              <p className="text-sm text-muted-foreground">{lang === "ar" ? "لا توجد عناصر مراجعة." : "No review items."}</p>
            ) : (
              <Section title={lang === "ar" ? "عناصر المراجعة" : "Review items"}>
                <FieldList>
                  {d.reviews.map((r) => (
                    <div key={r.id} className="flex items-center justify-between px-3 py-2 text-sm">
                      <Badge variant={r.status === "pending" ? "warning" : "secondary"}>{r.status}</Badge>
                      <span className="text-xs text-muted-foreground">{r.decisionRationale ?? (lang === "ar" ? `أولوية ${r.priority}` : `priority ${r.priority}`)}</span>
                    </div>
                  ))}
                </FieldList>
              </Section>
            )}
          </TabsContent>

          <TabsContent value="provenance" className="space-y-4">
            <Section title={lang === "ar" ? "سجل التدقيق" : "Audit history"}>
              <AuditList entries={d.audit} />
            </Section>
            <RawRow row={a.rawRow} />
          </TabsContent>
        </Tabs>
      )}
    </Drawer>
  );
}
