import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useLanguage } from "@/hooks/useLanguage";
import { useToast } from "@/hooks/use-toast";
import type { Selection } from "@/hooks/useSelection";
import type { CatalogScreen, FilterState } from "@shared/lib/filter-defs";
import { cn } from "@/lib/utils";
import { Modal } from "./Modal";
import { Btn } from "./Btn";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

// Client mirror of the export column catalog (server/exchange/columns.ts keys).
const COLUMN_GROUPS: Record<string, { key: string; label: string }[]> = {
  Identity: [
    { key: "ikcAssetId", label: "Asset Id" },
    { key: "assetName", label: "Asset Name" },
    { key: "columnName", label: "Column Name" },
  ],
  Technical: [
    { key: "dataType", label: "Data Type" },
    { key: "nativeType", label: "Native Type" },
    { key: "nullable", label: "Nullable" },
    { key: "isPrimaryKey", label: "Is PK" },
  ],
  Governance: [
    { key: "columnDataClassification", label: "Classification" },
    { key: "selectedDataClassName", label: "Selected Class" },
  ],
  "PII Findings": [
    { key: "piiName", label: "PII Name" },
    { key: "piiDescription", label: "PII Description" },
    { key: "verdict", label: "PII Verdict" },
    { key: "criteriaMatched", label: "Criteria Matched" },
    { key: "confidence", label: "Confidence" },
  ],
  Steward: [
    { key: "pii_decision", label: "PII Decision (editable)" },
    { key: "classification_decision", label: "Classification Decision (editable)" },
  ],
};

const PRESETS: Record<string, string[]> = {
  "ikc-round-trip": ["ikcAssetId", "assetName", "columnName", "dataType", "nativeType", "selectedDataClassName", "columnDataClassification"],
  "steward-review": ["ikcAssetId", "assetName", "columnName", "verdict", "criteriaMatched", "confidence", "overallRationaleEn", "piiName", "pii_decision", "classification_decision"],
  "full-export": Object.values(COLUMN_GROUPS).flat().map((c) => c.key),
};

export function ExportDialog({
  open,
  onOpenChange,
  screen,
  filters,
  selection,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  screen: CatalogScreen;
  filters: FilterState;
  selection?: Selection;
}) {
  const { lang } = useLanguage();
  const { toast } = useToast();
  const [scopeKind, setScopeKind] = useState<"selection" | "filter" | "all">(selection ? "selection" : "filter");
  const [columns, setColumns] = useState<string[]>(PRESETS["steward-review"]);
  // "report" = pick PDTC columns; "round-trip" = the uploaded IKC file returned
  // with its Pii / Classification columns filled in.
  const [mode, setMode] = useState<"report" | "round-trip">("report");

  // Which loaded catalog to export. Defaults to whatever the page is already
  // filtered to, so the dialog agrees with the screen behind it, but can be
  // changed here — exporting is usually a standalone act and having to go and
  // set the page filter first was the wrong order of operations.
  const filteredCatalogs = (filters.importBatch as string[] | undefined) ?? [];
  const [catalog, setCatalog] = useState<string>(filteredCatalogs.length === 1 ? filteredCatalogs[0] : "");
  const catalogQuery = useQuery<Array<{ value: string; count: number; label?: string }>>({
    queryKey: [`/api/catalog/filter-options?screen=${screen}&key=importBatch`],
    enabled: open,
  });

  /**
   * Catalog choice is applied ON TOP of the scope, not beside it: picking one
   * with "Everything" means everything in that catalog, which is what a steward
   * means by it. Leaving it on "All catalogs" preserves the previous behaviour.
   */
  const scopeBody = () => {
    const base = scopeKind === "filter" ? { ...filters } : {};
    if (catalog) base.importBatch = [catalog];
    const scoped = scopeKind === "selection" || Object.keys(base).length === 0;
    return {
      screen,
      scope: {
        kind: scopeKind === "selection" ? "selection" : scoped ? "all" : "filter",
        selection: scopeKind === "selection" ? selection : undefined,
        filters: scopeKind === "selection" || scoped ? undefined : base,
      },
      format: "xlsx" as const,
    };
  };

  const roundTripMutation = useMutation({
    mutationFn: async () => {
      // Streams the workbook straight back rather than creating an export batch —
      // this is the source file returned, not a PDTC report to persist.
      const res = await fetch("/api/exports/round-trip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(scopeBody()),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message ?? "Export failed");
      const rows = res.headers.get("X-PDTC-Rows") ?? "?";
      const filled = res.headers.get("X-PDTC-Filled") ?? "0";
      const blob = await res.blob();
      return { blob, rows, filled };
    },
    onSuccess: ({ blob, rows, filled }) => {
      toast({ title: "Export ready", description: `${rows} rows · ${filled} with engine findings` });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pdtc-ikc-with-pii-${rows}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      onOpenChange(false);
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "Export failed", description: err.message }),
  });

  const exportMutation = useMutation({
    mutationFn: () =>
      apiRequest<{ batchId: number; filename: string; rowCount: number }>("POST", "/api/exports", {
        ...scopeBody(),
        columns,
      }),
    onSuccess: (res) => {
      toast({ title: "Export ready", description: `${res.rowCount} rows` });
      const a = document.createElement("a");
      a.href = `/api/exports/${res.batchId}/download`;
      a.download = res.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      onOpenChange(false);
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "Export failed", description: err.message }),
  });

  const toggleCol = (key: string) => setColumns((c) => (c.includes(key) ? c.filter((x) => x !== key) : [...c, key]));

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={lang === "ar" ? "تصدير إلى Excel" : "Export to Excel"}
      description={lang === "ar" ? "اختر النطاق والأعمدة." : "Choose scope and columns."}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{lang === "ar" ? "إلغاء" : "Cancel"}</Button>
          <Btn
            icon={<Download className="h-4 w-4" />}
            loading={exportMutation.isPending || roundTripMutation.isPending}
            disabled={mode === "report" && columns.length === 0}
            onClick={() => (mode === "round-trip" ? roundTripMutation.mutate() : exportMutation.mutate())}
          >
            {lang === "ar" ? "إنشاء" : "Generate"}
          </Btn>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <Label className="mb-1 block text-sm">{lang === "ar" ? "النطاق" : "Scope"}</Label>
          <div className="flex flex-wrap gap-3 text-sm">
            {selection && <Radio checked={scopeKind === "selection"} onChange={() => setScopeKind("selection")} label={lang === "ar" ? "التحديد الحالي" : "Current selection"} />}
            <Radio checked={scopeKind === "filter"} onChange={() => setScopeKind("filter")} label={lang === "ar" ? "المجموعة المُرشّحة" : "Current filtered set"} />
            <Radio checked={scopeKind === "all"} onChange={() => setScopeKind("all")} label={lang === "ar" ? "كل شيء" : "Everything"} />
          </div>
        </div>

        {/* Catalog is its own choice rather than something you had to go and set
            on the page behind this dialog. Hidden when only one catalog exists —
            a picker with a single option is just a label. */}
        {scopeKind !== "selection" && (catalogQuery.data?.length ?? 0) > 1 && (
          <div>
            <Label htmlFor="export-catalog" className="mb-1 block text-sm">
              {lang === "ar" ? "الكتالوج (الاستيراد)" : "Catalog (import)"}
            </Label>
            <select
              id="export-catalog"
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={catalog}
              onChange={(e) => setCatalog(e.target.value)}
            >
              <option value="">
                {lang === "ar" ? "كل الكتالوجات" : "All catalogs"}
              </option>
              {(catalogQuery.data ?? []).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label ?? o.value} ({o.count.toLocaleString()})
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <Label className="mb-1 block text-sm">{lang === "ar" ? "نوع الملف" : "What to export"}</Label>
          <div className="space-y-2">
            <div className="flex items-start gap-2 rounded-md border p-2 text-sm">
              <input id="export-mode-report" type="radio" className="mt-1" checked={mode === "report"} onChange={() => setMode("report")} />
              <label htmlFor="export-mode-report" className="cursor-pointer">
                <span className="font-medium">{lang === "ar" ? "تقرير PDTC" : "PDTC report"}</span>
                <span className="block text-xs text-muted-foreground">
                  {lang === "ar" ? "اختر أعمدة PDTC أدناه." : "Pick the PDTC columns below."}
                </span>
              </label>
            </div>
            <div className="flex items-start gap-2 rounded-md border p-2 text-sm">
              <input id="export-mode-roundtrip" type="radio" className="mt-1" checked={mode === "round-trip"} onChange={() => setMode("round-trip")} />
              <label htmlFor="export-mode-roundtrip" className="cursor-pointer">
                <span className="font-medium">{lang === "ar" ? "ملف IKC الأصلي + النتائج" : "Original IKC file + PII"}</span>
                <span className="block text-xs text-muted-foreground">
                  {lang === "ar"
                    ? "ملفك كما تم رفعه، مع تعبئة أعمدة البيانات الشخصية والتصنيف — جاهز للإعادة إلى IKC."
                    : "Your uploaded file with its PII and Classification columns filled in — ready to go back into IKC."}
                </span>
              </label>
            </div>
          </div>
        </div>

        {mode === "report" && (
        <div>
          <Label className="mb-1 block text-sm">{lang === "ar" ? "الإعدادات المسبقة" : "Presets"}</Label>
          <div className="flex flex-wrap gap-2">
            {Object.keys(PRESETS).map((p) => (
              <Button key={p} size="sm" variant="outline" onClick={() => setColumns(PRESETS[p])}>{p}</Button>
            ))}
          </div>
        </div>
        )}

        <div className={cn("max-h-56 space-y-3 overflow-y-auto rounded-md border p-3", mode !== "report" && "hidden")}>
          {Object.entries(COLUMN_GROUPS).map(([group, cols]) => (
            <div key={group}>
              <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{group}</p>
              <div className="grid grid-cols-2 gap-1">
                {cols.map((c) => (
                  <label key={c.key} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={columns.includes(c.key)} onCheckedChange={() => toggleCol(c.key)} />
                    {c.label}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function Radio({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <label className="flex items-center gap-1.5">
      <input type="radio" checked={checked} onChange={onChange} />
      {label}
    </label>
  );
}
