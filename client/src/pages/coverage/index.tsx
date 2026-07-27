import { useQuery } from "@tanstack/react-query";
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
import { AlertTriangle, CheckCircle2, Database, ListChecks, ShieldAlert, ScanSearch, Fingerprint, Gauge } from "lucide-react";
import { useLanguage } from "@/hooks/useLanguage";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/pdtc/DataTable";

interface FieldStatus {
  key: string;
  labelEn: string;
  labelAr: string;
  providedBy: "ikc" | "pdtc";
  present: boolean;
}
interface CompletionRow {
  attributeId: number;
  columnName: string;
  assetName: string;
  fields: FieldStatus[];
  completeCount: number;
  totalCount: number;
}
interface CompletionReport {
  rows: CompletionRow[];
  summary: {
    attributes: number;
    fullyComplete: number;
    missingPdtcFields: number;
    incompleteTotal: number;
    fieldTotals: Record<string, { present: number; total: number }>;
  };
}
interface ReviewItem {
  id: number;
}
interface AttrKpis {
  total: number;
  pii: number;
  specialCategory: number;
  analysed: number;
  pendingReview: number;
  uncertain: number;
  avgConfidence: number;
  belowThreshold: number;
  criteriaDistribution: Record<string, number>;
  classificationDistribution: Record<string, number>;
}
interface DensityRow {
  key: string;
  label: string;
  total: number;
  analysed: number;
  pii: number;
  special: number;
  density: number;
}
interface Density {
  byDomain: DensityRow[];
  byTable: DensityRow[];
}

export default function CoveragePage() {
  const { t, lang } = useLanguage();
  const completionQuery = useQuery<CompletionReport>({ queryKey: ["/api/classification/completion"] });
  const pendingQuery = useQuery<ReviewItem[]>({ queryKey: ["/api/review/items?status=pending"] });
  const kpisQuery = useQuery<AttrKpis>({ queryKey: ["/api/catalog/kpis?screen=attributes"] });
  const densityQuery = useQuery<Density>({ queryKey: ["/api/catalog/pii-density?top=12"] });
  const kpis = kpisQuery.data;
  const byDomain = densityQuery.data?.byDomain ?? [];
  const byTable = densityQuery.data?.byTable ?? [];
  const pct = (n: number, d: number) => (d ? Math.round((100 * n) / d) : 0);

  const summary = completionQuery.data?.summary;
  const chartData = summary
    ? Object.entries(summary.fieldTotals).map(([key, v]) => ({
        field: key,
        pct: v.total ? Math.round((v.present / v.total) * 100) : 0,
      }))
    : [];

  const incompleteRows = (completionQuery.data?.rows ?? []).filter((r) => r.completeCount < r.totalCount);

  const columns: Column<CompletionRow>[] = [
    {
      key: "column",
      header: t("field.column"),
      render: (r) => (
        <div>
          <p className="font-medium">{r.columnName}</p>
          <p className="text-xs text-muted-foreground">{r.assetName}</p>
        </div>
      ),
    },
    {
      key: "complete",
      header: lang === "ar" ? "الاكتمال" : "Completion",
      render: (r) => (
        <span className="tabular-nums">
          {r.completeCount}/{r.totalCount}
        </span>
      ),
    },
    {
      key: "missing",
      header: lang === "ar" ? "الحقول الناقصة" : "Missing fields",
      render: (r) => (
        <div className="flex flex-wrap gap-1">
          {r.fields.filter((f) => !f.present).map((f) => (
            <span
              key={f.key}
              className={`rounded px-1.5 py-0.5 text-[10px] ${f.providedBy === "pdtc" ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground"}`}
            >
              {lang === "ar" ? f.labelAr : f.labelEn}
            </span>
          ))}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t("coverage.title")}</h1>
        <p className="text-sm text-muted-foreground">
          {lang === "ar" ? "لمحة عن كشف البيانات الشخصية وتغطية الوسم واكتمال البيانات الوصفية." : "PII detection, tagging coverage, and metadata completeness at a glance."}
        </p>
      </header>

      {/* PII overview — reads committed detections (approved + auto-published "commit & see"). */}
      <section className="space-y-4">
        <div className="flex items-baseline gap-2">
          <h2 className="text-lg font-semibold">{lang === "ar" ? "لمحة عن البيانات الشخصية" : "PII overview"}</h2>
          <span className="text-xs text-muted-foreground">{lang === "ar" ? "من النتائج المعتمدة والمنشورة" : "from approved + published detections"}</span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Kpi icon={<ScanSearch className="h-5 w-5 text-primary" />} label={lang === "ar" ? "تم تحليلها" : "Analysed"} value={kpis?.analysed ?? 0} sub={kpis ? `${pct(kpis.analysed, kpis.total)}% ${lang === "ar" ? "من" : "of"} ${kpis.total.toLocaleString()}` : undefined} />
          <Kpi icon={<Fingerprint className="h-5 w-5 text-primary" />} label={lang === "ar" ? "أعمدة شخصية" : "PII columns"} value={kpis?.pii ?? 0} sub={kpis ? `${pct(kpis.pii, kpis.analysed)}% ${lang === "ar" ? "من المحلَّلة" : "of analysed"}` : undefined} />
          <Kpi icon={<ShieldAlert className="h-5 w-5 text-destructive" />} label={lang === "ar" ? "فئات خاصة" : "Special category"} value={kpis?.specialCategory ?? 0} />
          <Kpi icon={<Gauge className="h-5 w-5 text-primary" />} label={lang === "ar" ? "متوسط الثقة" : "Avg confidence"} value={kpis ? `${Math.round(kpis.avgConfidence * 100)}%` : "—"} />
          <Kpi icon={<AlertTriangle className="h-5 w-5 text-warning" />} label={lang === "ar" ? "دون العتبة" : "Below threshold"} value={kpis?.belowThreshold ?? 0} sub={lang === "ar" ? "تحتاج مراجعة" : "need review"} />
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

      <h2 className="text-lg font-semibold">{lang === "ar" ? "اكتمال البيانات الوصفية" : "Metadata completeness"}</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi icon={<Database className="h-5 w-5" />} label={lang === "ar" ? "السمات" : "Attributes"} value={summary?.attributes ?? 0} />
        <Kpi icon={<CheckCircle2 className="h-5 w-5 text-success" />} label={lang === "ar" ? "مكتملة" : "Fully complete"} value={summary?.fullyComplete ?? 0} />
        <Kpi icon={<AlertTriangle className="h-5 w-5 text-warning" />} label={lang === "ar" ? "تنقصها حقول PDTC" : "Missing PDTC fields"} value={summary?.missingPdtcFields ?? 0} />
        <Kpi icon={<ListChecks className="h-5 w-5 text-primary" />} label={lang === "ar" ? "بانتظار المراجعة" : "Pending review"} value={pendingQuery.data?.length ?? 0} />
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
                  {chartData.map((d) => (
                    <Cell key={d.field} fill={d.pct >= 80 ? "hsl(var(--success))" : d.pct >= 50 ? "hsl(var(--warning))" : "hsl(var(--destructive))"} />
                  ))}
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
            <p className="text-xs text-muted-foreground">
              {lang === "ar"
                ? `عرض أول ${incompleteRows.length} من ${summary.incompleteTotal}`
                : `Showing first ${incompleteRows.length} of ${summary.incompleteTotal}`}
            </p>
          )}
        </CardHeader>
        <CardContent>
          <DataTable columns={columns} rows={incompleteRows} getRowKey={(r) => r.attributeId} loading={completionQuery.isLoading} emptyTitle={lang === "ar" ? "كل السمات مكتملة" : "All attributes complete"} />
        </CardContent>
      </Card>
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
  return (
    <p className="py-8 text-center text-sm text-muted-foreground">
      {lang === "ar" ? "لا توجد نتائج بعد — شغّل الكشف وانشر النتائج." : "No detections yet — run detection and publish results."}
    </p>
  );
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
          {data.map((d) => (
            <Cell key={d.key} fill={d.densityPct >= 50 ? "hsl(var(--destructive))" : d.densityPct >= 20 ? "hsl(var(--warning))" : "hsl(var(--primary))"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
