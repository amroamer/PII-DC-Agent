import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Play, TriangleAlert } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLanguage } from "@/hooks/useLanguage";
import { useToast } from "@/hooks/use-toast";
import { CRITERION_CODES, type CriterionCode } from "@shared/lib/criteria";
import type { Detection, DetectionVerdict } from "@shared/models/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Drawer } from "@/components/pdtc/Drawer";
import { EvidencePanel, type EvidencePayload } from "@/components/pdtc/EvidencePanel";

interface MergedDecision {
  verdict: DetectionVerdict;
  criterion: CriterionCode | null;
  confidence: number;
  conflict: boolean;
  contributingLayers: string[];
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
  results: ResultRow[];
}

const ALL = "__all__";

export default function DetectionPage() {
  const { t, lang } = useLanguage();
  const { toast } = useToast();
  const [criterion, setCriterion] = useState<string>(ALL);
  const [verdict, setVerdict] = useState<string>(ALL);
  const [minConfidence, setMinConfidence] = useState<string>("0");
  const [selectedDetectionId, setSelectedDetectionId] = useState<number | null>(null);

  const queryUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (criterion !== ALL) params.set("criterion", criterion);
    if (verdict !== ALL) params.set("verdict", verdict);
    if (Number(minConfidence) > 0) params.set("minConfidence", minConfidence);
    const qs = params.toString();
    return `/api/pii-detection/results${qs ? `?${qs}` : ""}`;
  }, [criterion, verdict, minConfidence]);

  const resultsQuery = useQuery<ResultsResponse>({ queryKey: [queryUrl] });

  const runMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/pii-detection/runs", { useLlmLayer: true }),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: [queryUrl] });
      toast({
        title: "Detection run complete",
        description: `${res.attributesProcessed} attributes · ${res.piiCount} PII · ${res.conflicts} conflicts · ${res.reviewItemsCreated} queued`,
      });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "Run failed", description: err.message }),
  });

  const evidenceQuery = useQuery<EvidencePayload>({
    queryKey: [`/api/pii-detection/evidence/${selectedDetectionId}`],
    enabled: selectedDetectionId !== null,
  });

  function openEvidence(row: ResultRow) {
    const top = [...row.layers].sort((a, b) => b.confidence - a.confidence)[0];
    if (top) setSelectedDetectionId(top.id);
  }

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
    { key: "verdict", header: t("field.verdict"), render: (r) => <VerdictPill verdict={r.merged.verdict} /> },
    {
      key: "criterion",
      header: t("field.criterion"),
      render: (r) => (r.merged.criterion ? <CriterionBadge code={r.merged.criterion} /> : <span className="text-muted-foreground">—</span>),
    },
    { key: "confidence", header: t("field.confidence"), render: (r) => <ConfidenceBar value={r.merged.confidence} /> },
    {
      key: "layers",
      header: "Layers",
      render: (r) => (
        <div className="flex items-center gap-1">
          {r.merged.contributingLayers.map((l) => (
            <span key={l} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{l}</span>
          ))}
          {r.merged.conflict && <TriangleAlert className="h-4 w-4 text-warning" />}
        </div>
      ),
    },
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
        <Btn icon={<Play className="h-4 w-4" />} loading={runMutation.isPending} onClick={() => runMutation.mutate()}>
          {t("detection.run")}
        </Btn>
      </header>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("detection.results")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
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
            rows={resultsQuery.data?.results ?? []}
            getRowKey={(r) => r.attributeId}
            loading={resultsQuery.isLoading}
            onRowClick={openEvidence}
            emptyTitle="No detections"
            emptyDescription="Run the detection engine over ingested attributes to see flagged results."
          />
        </CardContent>
      </Card>

      <Drawer
        open={selectedDetectionId !== null}
        onOpenChange={(open) => !open && setSelectedDetectionId(null)}
        title={t("detection.evidence")}
        description={lang === "ar" ? "الأدلة الوصفية التي قادت القرار" : "The metadata evidence behind the verdict"}
      >
        {evidenceQuery.data ? (
          <EvidencePanel payload={evidenceQuery.data} />
        ) : (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        )}
      </Drawer>
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
