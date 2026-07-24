import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, FileSpreadsheet, Upload } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLanguage } from "@/hooks/useLanguage";
import { useToast } from "@/hooks/use-toast";
import { IKC_FIELDS, type IkcSheetType } from "@shared/lib/ikc-fields";
import { formatDateTime } from "@/lib/formatDate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Btn } from "@/components/pdtc/Btn";
import { Alert } from "@/components/pdtc/Alert";
import { DataTable, type Column } from "@/components/pdtc/DataTable";

const NONE = "__none__";

interface UploadResponse {
  uploadId: string;
  filename: string;
  sheetType: IkcSheetType;
  headers: string[];
  mapping: Record<string, string | null>;
  rowCount: number;
  preview: Record<string, unknown>[];
  requiredFields: string[];
}

interface ImportSummary {
  runId: number;
  sheetType: IkcSheetType;
  filename: string;
  rowCount: number;
  assetsCreated: number;
  assetsUpdated: number;
  attributesCreated: number;
  skipped: number;
  warnings: string[];
}

interface IngestRun {
  id: number;
  filename: string;
  sheetType: string;
  rowCount: number;
  status: string;
  startedAt: string;
  finishedAt: string | null;
}

export default function IngestPage() {
  const { t, lang } = useLanguage();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [upload, setUpload] = useState<UploadResponse | null>(null);
  const [sheetType, setSheetType] = useState<IkcSheetType>("attribute");
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  const runsQuery = useQuery<IngestRun[]>({ queryKey: ["/api/ingest/runs"] });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/ingest/upload", {
        method: "POST",
        body: form,
        credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message ?? "Upload failed");
      return (await res.json()) as UploadResponse;
    },
    onSuccess: (data) => {
      setUpload(data);
      setSheetType(data.sheetType);
      setMapping(data.mapping);
      setSummary(null);
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "Upload failed", description: err.message }),
  });

  const importMutation = useMutation({
    mutationFn: (payload: { uploadId: string; sheetType: IkcSheetType; mapping: Record<string, string | null> }) =>
      apiRequest<ImportSummary>("POST", "/api/ingest/import", payload),
    onSuccess: (result) => {
      setSummary(result);
      setUpload(null);
      queryClient.invalidateQueries({ queryKey: ["/api/ingest/runs"] });
      toast({ title: "Import complete", description: `${result.attributesCreated} attributes, ${result.assetsCreated} assets.` });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "Import failed", description: err.message }),
  });

  const fields = IKC_FIELDS[sheetType];
  const requiredUnmapped = fields.filter((f) => f.required && !mapping[f.key]);

  const runColumns: Column<IngestRun>[] = [
    { key: "filename", header: t("field.asset"), render: (r) => <span className="font-medium">{r.filename}</span> },
    { key: "sheetType", header: "Sheet", render: (r) => <Badge variant="secondary">{r.sheetType}</Badge> },
    { key: "rowCount", header: "Rows" },
    {
      key: "status",
      header: t("field.status"),
      render: (r) => (
        <Badge variant={r.status === "completed" ? "success" : r.status === "failed" ? "destructive" : "secondary"}>
          {r.status}
        </Badge>
      ),
    },
    { key: "startedAt", header: "Started", render: (r) => formatDateTime(r.startedAt) },
  ];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t("ingest.title")}</h1>
        <p className="text-sm text-muted-foreground">
          {lang === "ar"
            ? "ارفع مخرجات IKC (بيانات وصفية فقط)، اربط الأعمدة، ثم نفّذ الاستيراد."
            : "Upload IKC exports (metadata only), map the columns, then run the import."}
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Upload className="h-4 w-4" /> {t("ingest.drop")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadMutation.mutate(file);
                e.target.value = "";
              }}
            />
            <Btn icon={<FileSpreadsheet className="h-4 w-4" />} loading={uploadMutation.isPending} onClick={() => fileRef.current?.click()}>
              {t("action.upload")} .xlsx
            </Btn>
            {upload && (
              <span className="text-sm text-muted-foreground">
                {upload.filename} · {upload.rowCount} rows · {upload.headers.length} columns
              </span>
            )}
          </div>

          {upload && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Label className="text-sm">Sheet type</Label>
                <Select value={sheetType} onValueChange={(v) => setSheetType(v as IkcSheetType)}>
                  <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="attribute">Attribute sheet</SelectItem>
                    <SelectItem value="asset">Asset sheet</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <h3 className="mb-2 text-sm font-semibold">{t("ingest.mapping")}</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  {fields.map((field) => (
                    <div key={field.key} className="flex items-center justify-between gap-2 rounded-md border p-2">
                      <div className="text-sm">
                        <span className="font-medium">{lang === "ar" ? "" : field.header}</span>
                        <span className="ms-1 text-xs text-muted-foreground">({field.key})</span>
                        {field.required && <span className="ms-1 text-destructive">*</span>}
                      </div>
                      <Select
                        value={mapping[field.key] ?? NONE}
                        onValueChange={(v) => setMapping((m) => ({ ...m, [field.key]: v === NONE ? null : v }))}
                      >
                        <SelectTrigger className="w-44"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>— unmapped —</SelectItem>
                          {upload.headers.map((h) => (
                            <SelectItem key={h} value={h}>{h}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </div>

              {requiredUnmapped.length > 0 && (
                <Alert tone="warning" title="Required fields not mapped">
                  {requiredUnmapped.map((f) => f.header).join(", ")}
                </Alert>
              )}

              <Btn
                loading={importMutation.isPending}
                disabled={requiredUnmapped.length > 0}
                onClick={() => importMutation.mutate({ uploadId: upload.uploadId, sheetType, mapping })}
              >
                {t("action.import")}
              </Btn>
            </div>
          )}
        </CardContent>
      </Card>

      {summary && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="h-4 w-4 text-success" /> {t("ingest.summary")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Attributes" value={summary.attributesCreated} />
              <Stat label="Assets created" value={summary.assetsCreated} />
              <Stat label="Assets updated" value={summary.assetsUpdated} />
              <Stat label="Skipped" value={summary.skipped} />
            </div>
            {summary.warnings.length > 0 && (
              <Alert tone="warning" title={`${summary.warnings.length} warning(s)`}>
                {summary.warnings.slice(0, 5).join(" · ")}
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("ingest.runs")}</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={runColumns}
            rows={runsQuery.data ?? []}
            getRowKey={(r) => r.id}
            loading={runsQuery.isLoading}
            emptyTitle="No import runs yet"
          />
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
