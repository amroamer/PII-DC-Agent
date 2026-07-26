import { useQuery } from "@tanstack/react-query";
import { Drawer } from "./Drawer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ClassificationBadge } from "./ClassificationBadge";
import { useLanguage } from "@/hooks/useLanguage";
import { Section, FieldList, Field, RawRow, AuditList, type AuditEntryView } from "./detail-parts";
import type { ClassificationCode } from "@shared/lib/classification";

interface AssetDetail {
  asset: Record<string, any>;
  attributes: Array<{
    id: number;
    columnName: string;
    dataType: string | null;
    columnDataClassification: ClassificationCode | null;
    piiName: string | null;
    cdeFlag: boolean;
    selectedDataClassName: string | null;
  }>;
  classification: {
    active: Record<string, any> | null;
    history: Array<Record<string, any>>;
    rollup: { level: ClassificationCode | null; drivers: string[] };
  };
  cooccurrence: Array<{ id: number; combinationLabel: string; riskScore: number; rationale: string | null }>;
  audit: AuditEntryView[];
}

export function AssetDetailDrawer({
  id,
  defaultTab = "overview",
  onClose,
  onOpenAttribute,
}: {
  id: number | null;
  defaultTab?: string;
  onClose: () => void;
  onOpenAttribute?: (attrId: number) => void;
}) {
  const { lang } = useLanguage();
  const { data: d } = useQuery<AssetDetail>({ queryKey: [`/api/catalog/assets/${id}`], enabled: id !== null });
  const s: any = d?.asset;
  const yn = (v: boolean) => (v ? (lang === "ar" ? "نعم" : "Yes") : (lang === "ar" ? "لا" : "No"));
  const list = (v: unknown): string => (Array.isArray(v) ? v.join(", ") : String(v ?? ""));

  return (
    <Drawer
      open={id !== null}
      onOpenChange={(o) => !o && onClose()}
      className="max-w-2xl"
      title={s?.name ?? (lang === "ar" ? "أصل" : "Asset")}
      description={s?.ikcAssetId}
    >
      {!d ? (
        <p className="text-sm text-muted-foreground">{lang === "ar" ? "جارٍ التحميل…" : "Loading…"}</p>
      ) : (
        <Tabs defaultValue={defaultTab} className="space-y-4">
          <TabsList className="flex flex-wrap">
            <TabsTrigger value="overview">{lang === "ar" ? "نظرة عامة" : "Overview"}</TabsTrigger>
            <TabsTrigger value="attributes">{lang === "ar" ? "السمات" : "Attributes"} ({d.attributes.length})</TabsTrigger>
            <TabsTrigger value="classification">{lang === "ar" ? "التصنيف" : "Classification"}</TabsTrigger>
            <TabsTrigger value="provenance">{lang === "ar" ? "الأثر" : "Provenance"}</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <Section title={lang === "ar" ? "التعريف" : "Identity"}>
              <FieldList>
                <Field label={lang === "ar" ? "الاسم" : "Name"}>{s.name}</Field>
                <Field label="IKC Asset ID">{s.ikcAssetId}</Field>
                <Field label={lang === "ar" ? "النوع" : "Type"}>{s.assetType}</Field>
                <Field label={lang === "ar" ? "المجال" : "Domain"}>{list(s.businessDomain)}</Field>
                <Field label={lang === "ar" ? "مجال الموضوع" : "Subject area"}>{list(s.subjectArea)}</Field>
                <Field label={lang === "ar" ? "القسم" : "Department"}>{list(s.department)}</Field>
                <Field label={lang === "ar" ? "القطاع" : "Sector"}>{list(s.sector)}</Field>
                <Field label={lang === "ar" ? "الوصف (EN)" : "Description (EN)"}>{s.descriptionEn}</Field>
                <Field label={lang === "ar" ? "الوصف (AR)" : "Description (AR)"}>{s.descriptionAr}</Field>
              </FieldList>
            </Section>
            <Section title={lang === "ar" ? "الحوكمة" : "Governance"}>
              <FieldList>
                <Field label={lang === "ar" ? "المالك" : "Owner"}>{s.ownerId}</Field>
                <Field label={lang === "ar" ? "الأمناء" : "Stewards"}>{list(s.stewards)}</Field>
                <Field label={lang === "ar" ? "التخزين" : "Storage"}>{s.storage}</Field>
                <Field label={lang === "ar" ? "الاحتفاظ" : "Retention"}>{s.retentionPeriod}</Field>
                <Field label={lang === "ar" ? "التصنيف" : "Classification"}><ClassificationBadge code={s.assetClassification ?? null} /></Field>
                <Field label="PII">{yn(s.piiFlag)}</Field>
                <Field label="CDE">{yn(s.cdeFlag)}</Field>
                <Field label={lang === "ar" ? "الجودة" : "Quality"}>{s.qualityScore}</Field>
              </FieldList>
            </Section>
            <Section title={lang === "ar" ? "تقني" : "Technical"}>
              <FieldList>
                <Field label={lang === "ar" ? "نوع الجدول" : "Table type"}>{s.tableType}</Field>
                <Field label={lang === "ar" ? "المخطط" : "Schema"}>{s.tableSchema}</Field>
                <Field label={lang === "ar" ? "مسار الاتصال" : "Connection path"}>{s.connectionPath}</Field>
                <Field label={lang === "ar" ? "عدد الأعمدة" : "Columns"}>{s.numColumns}</Field>
                <Field label={lang === "ar" ? "صفوف محلَّلة" : "Analysed rows"}>{s.analysedRowCount}</Field>
                <Field label={lang === "ar" ? "الوسوم" : "Tags"}>{Array.isArray(s.tags) ? s.tags.join(", ") : null}</Field>
              </FieldList>
            </Section>
          </TabsContent>

          <TabsContent value="attributes">
            <FieldList>
              {d.attributes.map((at) => (
                <button
                  key={at.id}
                  type="button"
                  onClick={() => onOpenAttribute?.(at.id)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-accent/50"
                >
                  <span className="flex-1 truncate font-medium">{at.columnName}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{at.dataType}</span>
                  {at.cdeFlag && <Badge variant="warning">CDE</Badge>}
                  <ClassificationBadge code={at.columnDataClassification} />
                </button>
              ))}
            </FieldList>
          </TabsContent>

          <TabsContent value="classification" className="space-y-4">
            <Section title={lang === "ar" ? "تصنيف الأصل" : "Asset classification"}>
              <FieldList>
                <Field label={lang === "ar" ? "المستوى المخزَّن" : "Stored level"}><ClassificationBadge code={s.assetClassification ?? null} /></Field>
                <Field label={lang === "ar" ? "التجميع المحسوب" : "Computed rollup"}><ClassificationBadge code={d.classification.rollup.level} /></Field>
                <Field label={lang === "ar" ? "الأعمدة المحرِّكة" : "Driven by"}>{d.classification.rollup.drivers.join(", ")}</Field>
              </FieldList>
            </Section>
            {d.cooccurrence.length > 0 && (
              <Section title={lang === "ar" ? "نتائج التواجد المشترك" : "Co-occurrence findings"}>
                <FieldList>
                  {d.cooccurrence.map((c) => (
                    <Field key={c.id} label={c.combinationLabel}>{`${Math.round(c.riskScore * 100)}% ${lang === "ar" ? "خطر" : "risk"}`}</Field>
                  ))}
                </FieldList>
              </Section>
            )}
          </TabsContent>

          <TabsContent value="provenance" className="space-y-4">
            <Section title={lang === "ar" ? "سجل التدقيق" : "Audit history"}>
              <AuditList entries={d.audit} />
            </Section>
            <RawRow row={s.rawRow} />
          </TabsContent>
        </Tabs>
      )}
    </Drawer>
  );
}
