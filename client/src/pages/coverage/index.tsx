import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, ChevronRight, Database, Fingerprint, Gauge, HelpCircle, Inbox, Layers, ListChecks, Lock, Play, ShieldAlert } from "lucide-react";
import { useLanguage } from "@/hooks/useLanguage";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/pdtc/DataTable";
import { cn } from "@/lib/utils";

interface FieldStatus { key: string; labelEn: string; labelAr: string; providedBy: "ikc" | "pdtc"; present: boolean }
interface CompletionRow { attributeId: number; columnName: string; assetName: string; fields: FieldStatus[]; completeCount: number; totalCount: number }
interface CompletionReport {
  rows: CompletionRow[];
  summary: { attributes: number; fullyComplete: number; missingPdtcFields: number; incompleteTotal: number; fieldTotals: Record<string, { present: number; total: number }> };
}
interface ReviewItem { id: number }
interface AttrKpis {
  total: number;
  tablesTotal: number;
  tablesAnalysed: number;
  pii: number;
  specialCategory: number;
  analysed: number;
  conflicts: number;
  pendingReview: number;
  uncertain: number;
  avgConfidence: number;
  belowThreshold: number;
  criteriaDistribution: Record<string, number>;
  classificationDistribution: Record<string, number>;
}
interface DensityRow { key: string; label: string; total: number; analysed: number; pii: number; special: number; density: number }
interface Density { byDomain: DensityRow[]; byTable: DensityRow[] }

const pct = (n: number, d: number) => (d ? Math.round((100 * n) / d) : 0);
/** Deep-link into the attribute catalog with a pre-applied filter (useCatalogState reads `attributes.f`). */
const attrLink = (filters: Record<string, unknown>) => `/attributes?${new URLSearchParams({ "attributes.f": JSON.stringify(filters) }).toString()}`;

export default function CoveragePage() {
  const { t, lang } = useLanguage();
  const completionQuery = useQuery<CompletionReport>({ queryKey: ["/api/classification/completion"] });
  const pendingQuery = useQuery<ReviewItem[]>({ queryKey: ["/api/review/items?status=pending"] });
  const kpisQuery = useQuery<AttrKpis>({ queryKey: ["/api/catalog/kpis?screen=attributes"] });
  const densityQuery = useQuery<Density>({ queryKey: ["/api/catalog/pii-density?top=12"] });
  const kpis = kpisQuery.data;
  const byDomain = densityQuery.data?.byDomain ?? [];
  const byTable = densityQuery.data?.byTable ?? [];

  const summary = completionQuery.data?.summary;
  const chartData = summary
    ? Object.entries(summary.fieldTotals).map(([key, v]) => ({ field: key, pct: v.total ? Math.round((v.present / v.total) * 100) : 0 }))
    : [];
  const incompleteRows = (completionQuery.data?.rows ?? []).filter((r) => r.completeCount < r.totalCount);
  const columns: Column<CompletionRow>[] = [
    { key: "column", header: t("field.column"), render: (r) => (<div><p className="font-medium">{r.columnName}</p><p className="text-xs text-muted-foreground">{r.assetName}</p></div>) },
    { key: "complete", header: lang === "ar" ? "الاكتمال" : "Completion", render: (r) => <span className="tabular-nums">{r.completeCount}/{r.totalCount}</span> },
    { key: "missing", header: lang === "ar" ? "الحقول الناقصة" : "Missing fields", render: (r) => (
      <div className="flex flex-wrap gap-1">
        {r.fields.filter((f) => !f.present).map((f) => (
          <span key={f.key} className={`rounded px-1.5 py-0.5 text-[10px] ${f.providedBy === "pdtc" ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground"}`}>{lang === "ar" ? f.labelAr : f.labelEn}</span>
        ))}
      </div>
    ) },
  ];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t("coverage.title")}</h1>
        <p className="text-sm text-muted-foreground">
          {lang === "ar" ? "تغطية التحليل، أين تتركّز البيانات الحسّاسة، وما الذي يحتاج إلى إجراء." : "How much is analysed, where the sensitive data is, and what needs your action."}
        </p>
      </header>

      {/* #1 Coverage hero */}
      <CoverageHero kpis={kpis} lang={lang} />

      {/* #2 Needs your attention */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{lang === "ar" ? "يحتاج إلى إجراء" : "Needs your attention"}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <ActionCard href="/review" icon={<Inbox className="h-5 w-5" />} tone="primary" value={kpis?.pendingReview ?? pendingQuery.data?.length ?? 0} label={lang === "ar" ? "بانتظار المراجعة" : "Pending review"} />
          <ActionCard href={attrLink({ verdict: ["uncertain"] })} icon={<HelpCircle className="h-5 w-5" />} tone="warning" value={kpis?.uncertain ?? 0} label={lang === "ar" ? "غير مؤكد" : "Uncertain"} />
          <ActionCard href={attrLink({ conflict: true })} icon={<AlertTriangle className="h-5 w-5" />} tone="warning" value={kpis?.conflicts ?? 0} label={lang === "ar" ? "تعارض" : "Conflicts"} />
          <ActionCard href={attrLink({ verdict: ["pii"], confidence: { max: 0.6 } })} icon={<Gauge className="h-5 w-5" />} tone="warning" value={kpis?.belowThreshold ?? 0} label={lang === "ar" ? "ثقة منخفضة" : "Low-confidence PII"} />
          <ActionCard href={attrLink({ columnDataClassification: ["SECRET"] })} icon={<Lock className="h-5 w-5" />} tone="destructive" value={kpis?.classificationDistribution?.SECRET ?? 0} label={lang === "ar" ? "سري" : "Secret"} />
        </div>
      </section>

      {/* #3 Risk & findings — classification posture + PII */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">{lang === "ar" ? "المخاطر والنتائج" : "Risk & findings"}</h2>
        <Card>
          <CardHeader><CardTitle className="text-base">{lang === "ar" ? "توزيع مستويات التصنيف" : "Classification levels"}</CardTitle></CardHeader>
          <CardContent>
            {kpis && Object.values(kpis.classificationDistribution ?? {}).some((n) => n > 0)
              ? <ClassificationBar dist={kpis.classificationDistribution} lang={lang} />
              : <p className="py-6 text-center text-sm text-muted-foreground">{lang === "ar" ? "لا تصنيفات معتمدة بعد — شغّل محرك التصنيف واعتمده." : "No approved classifications yet — run and approve the classification engine."}</p>}
          </CardContent>
        </Card>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi icon={<Fingerprint className="h-5 w-5 text-primary" />} label={lang === "ar" ? "أعمدة شخصية" : "PII columns"} value={kpis?.pii ?? 0} sub={kpis ? `${pct(kpis.pii, kpis.analysed)}% ${lang === "ar" ? "من المحلَّلة" : "of analysed"}` : undefined} />
          <Kpi icon={<ShieldAlert className="h-5 w-5 text-destructive" />} label={lang === "ar" ? "فئات خاصة" : "Special category"} value={kpis?.specialCategory ?? 0} />
          <Kpi icon={<Layers className="h-5 w-5 text-primary" />} label={lang === "ar" ? "سري" : "Secret columns"} value={kpis?.classificationDistribution?.SECRET ?? 0} />
          <Kpi icon={<Gauge className="h-5 w-5 text-primary" />} label={lang === "ar" ? "متوسط الثقة" : "Avg confidence"} value={kpis ? `${Math.round(kpis.avgConfidence * 100)}%` : "—"} />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-base">{lang === "ar" ? "كثافة PII حسب مجال العمل" : "PII by business domain"}</CardTitle></CardHeader>
            <CardContent>{byDomain.length === 0 ? <EmptyChart lang={lang} /> : <DensityChart rows={byDomain} lang={lang} />}</CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">{lang === "ar" ? "أعلى الجداول من حيث PII" : "Top tables by PII"}</CardTitle></CardHeader>
            <CardContent>{byTable.length === 0 ? <EmptyChart lang={lang} /> : <DensityChart rows={byTable} lang={lang} />}</CardContent>
          </Card>
        </div>
      </section>

      {/* #4 Data quality — metadata completeness (demoted) */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">{lang === "ar" ? "جودة البيانات الوصفية" : "Metadata completeness"}</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Kpi icon={<Database className="h-5 w-5" />} label={lang === "ar" ? "السمات" : "Attributes"} value={summary?.attributes ?? 0} />
          <Kpi icon={<ListChecks className="h-5 w-5 text-success" />} label={lang === "ar" ? "مكتملة" : "Fully complete"} value={summary?.fullyComplete ?? 0} />
          <Kpi icon={<AlertTriangle className="h-5 w-5 text-warning" />} label={lang === "ar" ? "تنقصها حقول PDTC" : "Missing PDTC fields"} value={summary?.missingPdtcFields ?? 0} />
        </div>
        <Card>
          <CardHeader><CardTitle className="text-base">{lang === "ar" ? "تغطية الحقول الإلزامية" : "Required-field coverage"}</CardTitle></CardHeader>
          <CardContent>
            {chartData.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">{lang === "ar" ? "لا توجد بيانات بعد — شغّل المحركات." : "No data yet — run the engines."}</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="field" tick={{ fontSize: 11 }} angle={-15} textAnchor="end" height={60} stroke="hsl(var(--muted-foreground))" />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" unit="%" />
                  <RechartsTooltip cursor={{ fill: "hsl(var(--muted))" }} />
                  <Bar dataKey="pct" radius={[4, 4, 0, 0]}>
                    {chartData.map((d) => (<Cell key={d.field} fill={d.pct >= 80 ? "hsl(var(--success))" : d.pct >= 50 ? "hsl(var(--warning))" : "hsl(var(--destructive))"} />))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{lang === "ar" ? "سمات غير مكتملة" : "Attributes with incomplete metadata"}</CardTitle>
            {summary && summary.incompleteTotal > incompleteRows.length && (
              <p className="text-xs text-muted-foreground">{lang === "ar" ? `عرض أول ${incompleteRows.length} من ${summary.incompleteTotal}` : `Showing first ${incompleteRows.length} of ${summary.incompleteTotal}`}</p>
            )}
          </CardHeader>
          <CardContent>
            <DataTable columns={columns} rows={incompleteRows} getRowKey={(r) => r.attributeId} loading={completionQuery.isLoading} emptyTitle={lang === "ar" ? "كل السمات مكتملة" : "All attributes complete"} />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

/** #1 — the headline: how much of the catalogue is analysed, with a "scan the rest" CTA. */
function CoverageHero({ kpis, lang }: { kpis?: AttrKpis; lang: string }) {
  const analysed = kpis?.analysed ?? 0;
  const total = kpis?.total ?? 0;
  const p = pct(analysed, total);
  const tablesAnalysed = kpis?.tablesAnalysed ?? 0;
  const tablesTotal = kpis?.tablesTotal ?? 0;
  const unscanned = Math.max(0, tablesTotal - tablesAnalysed);
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-muted-foreground">{lang === "ar" ? "تغطية التحليل" : "Analysis coverage"}</p>
            <p className="text-4xl font-bold tabular-nums">{p}%</p>
            <p className="text-sm text-muted-foreground">
              {analysed.toLocaleString()} / {total.toLocaleString()} {lang === "ar" ? "عمود" : "columns"} · {tablesAnalysed.toLocaleString()} / {tablesTotal.toLocaleString()} {lang === "ar" ? "جدول محلَّل" : "tables analysed"}
            </p>
          </div>
          {unscanned > 0 && (
            <Link href="/detection" className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90">
              <Play className="h-4 w-4" /> {lang === "ar" ? `افحص ${unscanned.toLocaleString()} جدولاً متبقياً` : `Scan ${unscanned.toLocaleString()} remaining tables`}
            </Link>
          )}
        </div>
        <div className="mt-4 h-3 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${p}%` }} />
        </div>
      </CardContent>
    </Card>
  );
}

/** #2 — one clickable card that deep-links to the filtered catalog / review queue. */
function ActionCard({ href, icon, label, value, tone }: { href: string; icon: React.ReactNode; label: string; value: number; tone: "primary" | "warning" | "destructive" }) {
  const toneBg = { primary: "bg-primary/10 text-primary", warning: "bg-warning/15 text-warning", destructive: "bg-destructive/15 text-destructive" }[tone];
  return (
    <Link href={href} className="group block rounded-lg border bg-card p-4 transition hover:border-foreground/30 hover:bg-accent/40">
      <div className="flex items-center gap-3">
        <div className={cn("rounded-md p-2", toneBg)}>{icon}</div>
        <div className="min-w-0">
          <p className={cn("text-2xl font-semibold tabular-nums", value > 0 && tone === "destructive" && "text-destructive")}>{value.toLocaleString()}</p>
          <p className="truncate text-xs text-muted-foreground">{label}</p>
        </div>
        <ChevronRight className="ms-auto h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
      </div>
    </Link>
  );
}

/** #3 — a single colour-coded stacked bar of the classification levels + a counted legend. */
const LEVEL_ORDER = ["SECRET", "SENSITIVE", "CONFIDENTIAL", "OPEN", "UNCLASSIFIED"] as const;
const LEVEL_COLOR: Record<string, string> = {
  SECRET: "hsl(var(--destructive))",
  SENSITIVE: "hsl(var(--warning))",
  CONFIDENTIAL: "hsl(217 91% 60%)",
  OPEN: "hsl(var(--success))",
  UNCLASSIFIED: "hsl(var(--muted-foreground) / 0.4)",
};
function ClassificationBar({ dist, lang }: { dist: Record<string, number>; lang: string }) {
  const labels: Record<string, string> = {
    SECRET: lang === "ar" ? "سري" : "Secret",
    SENSITIVE: lang === "ar" ? "حسّاس" : "Sensitive",
    CONFIDENTIAL: lang === "ar" ? "سري (عادي)" : "Confidential",
    OPEN: lang === "ar" ? "مفتوح" : "Open",
    UNCLASSIFIED: lang === "ar" ? "غير مصنّف" : "Unclassified",
  };
  const total = LEVEL_ORDER.reduce((s, k) => s + (dist[k] ?? 0), 0) || 1;
  return (
    <div className="space-y-3">
      <div className="flex h-7 w-full overflow-hidden rounded-md border">
        {LEVEL_ORDER.map((k) => {
          const n = dist[k] ?? 0;
          if (!n) return null;
          return <div key={k} style={{ width: `${(n / total) * 100}%`, backgroundColor: LEVEL_COLOR[k] }} title={`${labels[k]}: ${n}`} />;
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
        {LEVEL_ORDER.map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: LEVEL_COLOR[k] }} />
            {labels[k]} <span className="font-medium tabular-nums">{(dist[k] ?? 0).toLocaleString()}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: number | string; sub?: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 pt-6">
        <div className="rounded-md bg-muted p-2">{icon}</div>
        <div>
          <p className="text-2xl font-semibold tabular-nums">{typeof value === "number" ? value.toLocaleString() : value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
          {sub && <p className="text-[11px] text-muted-foreground/80">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyChart({ lang }: { lang: string }) {
  return <p className="py-8 text-center text-sm text-muted-foreground">{lang === "ar" ? "لا توجد نتائج بعد — شغّل الكشف وانشر النتائج." : "No detections yet — run detection and publish results."}</p>;
}

/** Horizontal PII-count bars per domain/table, coloured by PII density (share of the group's columns). */
function DensityChart({ rows, lang }: { rows: DensityRow[]; lang: string }) {
  const data = rows.map((r) => ({ ...r, densityPct: Math.round(r.density * 100) }));
  return (
    <ResponsiveContainer width="100%" height={Math.max(200, data.length * 34)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
        <XAxis type="number" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
        <YAxis type="category" dataKey="label" width={130} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
        <RechartsTooltip
          cursor={{ fill: "hsl(var(--muted))" }}
          formatter={(v, _n, item) => {
            const row = (item?.payload ?? {}) as DensityRow & { densityPct: number };
            return [`${v} PII · ${row.densityPct}% ${lang === "ar" ? "من" : "of"} ${row.total}`, lang === "ar" ? "أعمدة شخصية" : "PII columns"];
          }}
        />
        <Bar dataKey="pii" radius={[0, 4, 4, 0]}>
          {data.map((d) => (<Cell key={d.key} fill={d.densityPct >= 50 ? "hsl(var(--destructive))" : d.densityPct >= 20 ? "hsl(var(--warning))" : "hsl(var(--primary))"} />))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
