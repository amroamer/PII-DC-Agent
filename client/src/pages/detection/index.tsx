import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Play, Search, TriangleAlert } from "lucide-react";
import { useLanguage } from "@/hooks/useLanguage";
import { CRITERION_CODES, type CriterionCode } from "@shared/lib/criteria";
import { displayPiiType, isConfidenceNotable, layerSummary, oneLine } from "@shared/lib/detection-view";
import type { Detection, DetectionLayer, DetectionVerdict } from "@shared/models/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Btn } from "@/components/pdtc/Btn";
import { DataTable, type Column } from "@/components/pdtc/DataTable";
import { CriterionBadge } from "@/components/pdtc/CriterionBadge";
import { ConfidenceBar } from "@/components/pdtc/ConfidenceBar";
import { VerdictPill } from "@/components/pdtc/Pill";
import { AttributeDetailDrawer } from "@/components/pdtc/AttributeDetailDrawer";
import { EngineWizard } from "@/components/pdtc/EngineWizard";
import type { Selection } from "@/hooks/useSelection";

const ALL_ATTRS: Selection = { mode: "all-matching", filters: {}, excluded: [] };

interface MergedDecision {
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

interface ResultRow {
  attributeId: number;
  columnName: string;
  assetId: number;
  assetName: string;
  merged: MergedDecision;
  layers: Detection[];
}

interface ResultsResponse {
  runId: string | null;
  count: number;
  page: number;
  pageSize: number;
  results: ResultRow[];
}

const PAGE_SIZE = 50;

const ALL = "__all__";

export default function DetectionPage() {
  const { t, lang } = useLanguage();
  const [criterion, setCriterion] = useState<string>(ALL);
  const [verdict, setVerdict] = useState<string>(ALL);
  const [minConfidence, setMinConfidence] = useState<string>("0");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [detailAttrId, setDetailAttrId] = useState<number | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardScope, setWizardScope] = useState<"all" | "remaining">("all");
  const totalQuery = useQuery<{ total: number }>({ queryKey: ["/api/catalog/attributes?filters=%7B%7D&page=1&pageSize=1"] });

  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  // Any filter change invalidates the current page number.
  useEffect(() => setPage(1), [criterion, verdict, minConfidence, search]);

  const queryUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (criterion !== ALL) params.set("criterion", criterion);
    if (verdict !== ALL) params.set("verdict", verdict);
    if (Number(minConfidence) > 0) params.set("minConfidence", minConfidence);
    if (search) params.set("search", search);
    params.set("page", String(page));
    params.set("pageSize", String(PAGE_SIZE));
    return `/api/pii-detection/results?${params.toString()}`;
  }, [criterion, verdict, minConfidence, search, page]);

  const resultsQuery = useQuery<ResultsResponse>({ queryKey: [queryUrl] });
  const rows = useMemo(() => resultsQuery.data?.results ?? [], [resultsQuery.data]);
  const count = resultsQuery.data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  // A column that is "—" on every row of the page is worse than no column at
  // all, and which fields carry a signal depends entirely on the run: this
  // catalog's LLM layer emits no data class and votes alone.
  const hasDataClass = rows.some((r) => displayPiiType(r.merged));
  const hasLayerSignal = rows.some((r) => {
    const entries = layerSummary(r.layers, r.merged.verdict);
    return entries.length > 1 || entries.some((e) => !e.agrees);
  });

  const columns: Column<ResultRow>[] = [
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
      key: "verdict",
      header: t("field.verdict"),
      render: (r) => (
        <div className="flex items-center gap-1.5">
          <VerdictPill verdict={r.merged.verdict} />
          {r.merged.conflict && (
            <span title={lang === "ar" ? "الطبقات غير متفقة" : "Layers disagree"}>
              <TriangleAlert className="h-4 w-4 text-warning" />
            </span>
          )}
        </div>
      ),
    },
    ...(hasDataClass
      ? [
          {
            key: "dataClass",
            header: lang === "ar" ? "فئة البيانات" : "Data class",
            render: (r: ResultRow) => {
              const code = displayPiiType(r.merged);
              return code ? <span className="text-sm">{code}</span> : <span className="text-muted-foreground">—</span>;
            },
          },
        ]
      : []),
    {
      key: "criterion",
      header: t("field.criterion"),
      render: (r) => (r.merged.criterion ? <CriterionBadge code={r.merged.criterion} /> : <span className="text-muted-foreground">—</span>),
    },
    {
      key: "rationale",
      header: lang === "ar" ? "السبب" : "Why",
      headerClassName: "w-[34%]",
      render: (r) => {
        const text = oneLine(lang === "ar" ? r.merged.rationaleAr : r.merged.rationaleEn);
        if (!text) return <span className="text-muted-foreground">—</span>;
        // Full text lives in the drawer; the cell shows as much as fits on one line.
        return (
          <p className="line-clamp-2 max-w-[42ch] text-xs text-muted-foreground" title={text}>
            {text}
          </p>
        );
      },
    },
    {
      key: "confidence",
      header: t("field.confidence"),
      // A 99% reading on every row is noise. Render the meter only where the
      // number could actually change a steward's mind.
      render: (r) =>
        isConfidenceNotable(r.merged) ? (
          <ConfidenceBar value={r.merged.confidence} />
        ) : (
          <span className="tabular-nums text-xs text-muted-foreground">{Math.round(r.merged.confidence * 100)}%</span>
        ),
    },
    ...(hasLayerSignal
      ? [
          {
            key: "layers",
            header: lang === "ar" ? "الطبقات" : "Layers",
            render: (r: ResultRow) => {
              const entries = layerSummary(r.layers, r.merged.verdict);
              // A lone agreeing layer says nothing — only chip the rows where the
              // layers actually voted more than once, or disagreed.
              if (entries.length <= 1 && entries.every((e) => e.agrees)) {
                return <span className="text-muted-foreground">—</span>;
              }
              return (
                <div className="flex items-center gap-1">
                  {entries.map((e) => (
                    <span
                      key={e.layer}
                      title={`${e.label}: ${e.verdict} · ${Math.round(e.confidence * 100)}%`}
                      className={
                        e.agrees
                          ? "rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                          : "rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold text-warning"
                      }
                    >
                      {e.label}
                      {e.agrees ? "" : " ✕"}
                    </span>
                  ))}
                </div>
              );
            },
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("detection.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {resultsQuery.data?.runId
              ? `Run ${resultsQuery.data.runId} · ${resultsQuery.data.count} results`
              : lang === "ar" ? "لم يتم تشغيل أي كشف بعد" : "No detection run yet"}
          </p>
        </div>
        <div className="flex gap-2">
          <Btn variant="outline" onClick={() => { setWizardScope("remaining"); setWizardOpen(true); }}>
            {lang === "ar" ? "تشغيل المتبقّي" : "Run the remaining"}
          </Btn>
          <Btn icon={<Play className="h-4 w-4" />} onClick={() => { setWizardScope("all"); setWizardOpen(true); }}>
            {t("detection.run")}
          </Btn>
        </div>
      </header>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("detection.results")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder={lang === "ar" ? "بحث في الأعمدة والأسباب…" : "Search columns, assets, rationale…"}
                className="ps-9"
              />
            </div>
            <Filter label={t("field.criterion")}>
              <Select value={criterion} onValueChange={setCriterion}>
                <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All criteria</SelectItem>
                  {CRITERION_CODES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Filter>
            <Filter label={t("field.verdict")}>
              <Select value={verdict} onValueChange={setVerdict}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All verdicts</SelectItem>
                  <SelectItem value="pii">PII</SelectItem>
                  <SelectItem value="not_pii">Not PII</SelectItem>
                  <SelectItem value="uncertain">Uncertain</SelectItem>
                </SelectContent>
              </Select>
            </Filter>
            <Filter label={`${t("field.confidence")} ≥`}>
              <Select value={minConfidence} onValueChange={setMinConfidence}>
                <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["0", "0.5", "0.6", "0.7", "0.8"].map((v) => (
                    <SelectItem key={v} value={v}>{v === "0" ? "Any" : v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Filter>
          </div>

          <DataTable
            columns={columns}
            rows={rows}
            getRowKey={(r) => r.attributeId}
            loading={resultsQuery.isLoading}
            onRowClick={(r) => setDetailAttrId(r.attributeId)}
            emptyTitle="No detections"
            emptyDescription="Run the detection engine over ingested attributes to see flagged results."
          />

          {count > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {`${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, count)} ${lang === "ar" ? "من" : "of"} ${count}`}
              </span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  {lang === "ar" ? "السابق" : "Previous"}
                </Button>
                <span className="tabular-nums">{page} / {totalPages}</span>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                  {lang === "ar" ? "التالي" : "Next"}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <AttributeDetailDrawer id={detailAttrId} defaultTab="pii" onClose={() => setDetailAttrId(null)} />

      {wizardOpen && (
        <EngineWizard
          engineType="pii"
          screen="attributes"
          selection={ALL_ATTRS}
          selectedCount={totalQuery.data?.total ?? 0}
          initialScope={wizardScope}
          onClose={() => setWizardOpen(false)}
        />
      )}
    </div>
  );
}

function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}
