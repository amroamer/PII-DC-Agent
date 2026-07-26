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
import { AlertTriangle, CheckCircle2, Database, ListChecks } from "lucide-react";
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
    fieldTotals: Record<string, { present: number; total: number }>;
  };
}
interface ReviewItem {
  id: number;
}

export default function CoveragePage() {
  const { t, lang } = useLanguage();
  const completionQuery = useQuery<CompletionReport>({ queryKey: ["/api/classification/completion"] });
  const pendingQuery = useQuery<ReviewItem[]>({ queryKey: ["/api/review/items?status=pending"] });

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
          {lang === "ar" ? "لمحة عن تغطية الوسم واكتمال البيانات الوصفية والمراجعات المعلّقة." : "Tagging coverage, metadata completeness, and pending review at a glance."}
        </p>
      </header>

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
        <CardHeader><CardTitle className="text-base">{lang === "ar" ? "سمات غير مكتملة" : "Attributes with incomplete metadata"}</CardTitle></CardHeader>
        <CardContent>
          <DataTable columns={columns} rows={incompleteRows} getRowKey={(r) => r.attributeId} loading={completionQuery.isLoading} emptyTitle={lang === "ar" ? "كل السمات مكتملة" : "All attributes complete"} />
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 pt-6">
        <div className="rounded-md bg-muted p-2">{icon}</div>
        <div>
          <p className="text-2xl font-semibold tabular-nums">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}
