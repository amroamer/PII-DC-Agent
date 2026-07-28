import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowUp, ChevronRight, Info, TriangleAlert } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLanguage } from "@/hooks/useLanguage";
import { useToast } from "@/hooks/use-toast";
import type { Selection } from "@/hooks/useSelection";
import { FILTERS_BY_SCREEN, type CatalogScreen, type FilterState } from "@shared/lib/filter-defs";
import { CRITERION_CODES } from "@shared/lib/criteria";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Stepper } from "./Stepper";
import { FilterPanel } from "./FilterPanel";
import { Btn } from "./Btn";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert } from "./Alert";
import { VerdictPill } from "./Pill";
import { ConfidenceBar } from "./ConfidenceBar";
import { CriterionBadge } from "./CriterionBadge";
import { ClassificationBadge } from "./ClassificationBadge";
import { isCriterionCode } from "@shared/lib/criteria";
import { isClassificationCode } from "@shared/lib/classification";
import { cn } from "@/lib/utils";

/** Human-readable names for the raw sourceLayers tokens shown on run items. */
const LAYER_LABELS: Record<string, { en: string; ar: string }> = {
  classification_llm: { en: "AI model", ar: "نموذج الذكاء" },
  rule_floor: { en: "Policy floor", ar: "الحد الأدنى للسياسة" },
  llm: { en: "AI model", ar: "نموذج الذكاء" },
  ikc_class: { en: "IKC class library", ar: "مكتبة فئات IKC" },
  adc_class: { en: "ADC class library", ar: "مكتبة فئات ADC" },
  metadata_conflict: { en: "Metadata conflict", ar: "تعارض بيانات وصفية" },
  llm_unavailable: { en: "AI unavailable", ar: "الذكاء غير متاح" },
  self_consistency: { en: "Self-consistency", ar: "الاتساق الذاتي" },
};
const layerLabel = (l: string, lang: string) => (lang === "ar" ? LAYER_LABELS[l]?.ar : LAYER_LABELS[l]?.en) ?? l;

interface Framework {
  version: string;
  definition: {
    effective?: string;
    criteria?: Array<{ code: string; nameEn: string; description: string; evaluationMode: string }>;
    levels?: Array<{ code: string; labelEn: string; rank: number }>;
    rules?: Array<{ id: string; level: string; note?: string; criterion?: string; verdict?: string; isSpecialCategory?: boolean }>;
    rollup?: string;
  };
}
interface RunItem {
  id: number;
  targetId: number;
  columnName: string | null;
  assetName: string | null;
  verdict: string | null;
  suggestedClassCode: string | null;
  suggestedLevelCode: string | null;
  confidence: number;
  conflict: boolean;
  rationaleEn: string | null;
  rationaleAr: string | null;
  sourceLayers: string[] | null;
  stewardDecision: string;
  priority?: number;
  currentValue?: { columnDataClassification?: string | null } | null;
  assessments: Array<{ criterionCode: string; applies: boolean; rationaleEn: string; rationaleAr: string; confidence: number }>;
}
interface Preview {
  markedPii: number;
  markedNotPii: number;
  uncertainQueued: number;
  unchanged: number;
  diffs: Array<{ targetId: number; columnName: string; field: string; currentValue: string; newValue: string; source: string }>;
  assetRollups: Array<{ assetId: number; currentLevel: string; newLevel: string; driver: string }>;
}
interface ScopeTable {
  id: number;
  name: string;
  businessDomain: string[] | null;
  attributeCount: number;
  analysedCount: number;
  piiCount: number;
}

/** Plain-language strictness presets → the underlying confidence knobs. */
const STRICTNESS: Record<"balanced" | "strict" | "lenient", { confidenceThreshold: number; confidenceFloor: number }> = {
  balanced: { confidenceThreshold: 0.6, confidenceFloor: 0.3 },
  strict: { confidenceThreshold: 0.8, confidenceFloor: 0.4 },
  lenient: { confidenceThreshold: 0.5, confidenceFloor: 0.2 },
};

// Only the handful of filters that make sense for scoping a run (tables first),
// not the whole catalog filter set.
const SCOPE_FILTER_KEYS = new Set(["assetId", "businessDomain", "department", "dataType", "verdict", "columnDataClassification"]);
const SCOPE_FILTERS = FILTERS_BY_SCREEN.attributes.filter((d) => SCOPE_FILTER_KEYS.has(d.key));

export function EngineWizard({
  engineType,
  screen,
  selection,
  selectedCount,
  onClose,
  initialScope,
}: {
  engineType: "pii" | "classification";
  screen: CatalogScreen;
  selection: Selection;
  selectedCount: number;
  onClose: () => void;
  initialScope?: "selected" | "all" | "remaining";
}) {
  const { lang } = useLanguage();
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [unlocked, setUnlocked] = useState(0);
  const [runId, setRunId] = useState<number | null>(null);
  const [justification, setJustification] = useState("");
  const [onlyUncertain, setOnlyUncertain] = useState(false);
  const [onlyConflicts, setOnlyConflicts] = useState(false);
  const [sortBy, setSortBy] = useState<"default" | "priority" | "confidence">("default");
  const [params, setParams] = useState({
    confidenceThreshold: 0.6,
    confidenceFloor: 0.3,
    criteria: [...CRITERION_CODES] as string[],
    includeArabic: true,
    batchSize: 25,
    selfConsistencySamples: 1,
    useCache: true,
    forceFresh: false,
    skipApproved: true,
    incremental: false,
    publishConfident: false,
    batchInference: false,
    runNote: "",
  });
  const [strictness, setStrictness] = useState<"balanced" | "strict" | "lenient" | "custom">("balanced");
  const applyStrictness = (s: "balanced" | "strict" | "lenient") => {
    setStrictness(s);
    setParams((p) => ({ ...p, ...STRICTNESS[s] }));
  };

  const framework = useQuery<Framework>({ queryKey: [`/api/frameworks/${engineType}`] });

  // --- scope selection -------------------------------------------------------
  const remainingFilter: FilterState =
    engineType === "pii" ? { verdict: ["not_analysed"] } : { columnDataClassification: ["UNCLASSIFIED"] };
  const hasInitialSelection =
    selection.mode === "include"
      ? selection.ids.length > 0
      : selection.mode === "all-matching"
        ? Object.keys(selection.filters ?? {}).length > 0
        : false;
  const [scopeMode, setScopeMode] = useState<"selected" | "all" | "remaining" | "filtered">(
    initialScope ?? (hasInitialSelection ? "selected" : "all"),
  );
  const [scopeFilters, setScopeFilters] = useState<FilterState>({});
  const [tableSort, setTableSort] = useState<"attributes" | "name">("attributes");
  const [tableDir, setTableDir] = useState<"asc" | "desc">("desc");
  // Picklist of tables for the "filtered" scope. The assetId filter (which tables are already
  // picked) is stripped from the query so the list never shrinks to the current selection.
  const tableListFilters = useMemo(() => {
    const f: FilterState = { ...scopeFilters };
    delete (f as Record<string, unknown>).assetId;
    return f;
  }, [scopeFilters]);
  const tablesUrl = `/api/catalog/scope-tables?filters=${encodeURIComponent(JSON.stringify(tableListFilters))}&sort=${tableSort}&dir=${tableDir}`;
  const tablesQuery = useQuery<ScopeTable[]>({ queryKey: [tablesUrl], enabled: scopeMode === "filtered" });
  const selectedTables = useMemo(() => {
    const v = scopeFilters.assetId;
    return new Set(Array.isArray(v) ? (v as string[]) : v ? [String(v)] : []);
  }, [scopeFilters.assetId]);
  const toggleTable = (name: string) =>
    setScopeFilters((f) => {
      const cur = new Set(Array.isArray(f.assetId) ? (f.assetId as string[]) : f.assetId ? [String(f.assetId)] : []);
      if (cur.has(name)) cur.delete(name);
      else cur.add(name);
      const next: FilterState = { ...f };
      if (cur.size) (next as Record<string, unknown>).assetId = [...cur];
      else delete (next as Record<string, unknown>).assetId;
      return next;
    });
  const sortTablesBy = (col: "attributes" | "name") => {
    if (tableSort === col) setTableDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setTableSort(col);
      setTableDir(col === "attributes" ? "desc" : "asc");
    }
  };

  const effectiveSelection: Selection =
    scopeMode === "selected"
      ? selection
      : scopeMode === "all"
        ? { mode: "all-matching", filters: {}, excluded: [] }
        : scopeMode === "remaining"
          ? { mode: "all-matching", filters: remainingFilter, excluded: [] }
          : { mode: "all-matching", filters: scopeFilters, excluded: [] };

  // Live count for the chosen scope (selected uses the count passed from the catalog).
  const countFilters: FilterState | null =
    scopeMode === "selected" ? null : scopeMode === "all" ? {} : scopeMode === "remaining" ? remainingFilter : scopeFilters;
  const countUrl =
    countFilters !== null
      ? `/api/catalog/attributes?filters=${encodeURIComponent(JSON.stringify(countFilters))}&page=1&pageSize=1`
      : null;
  const countQuery = useQuery<{ total: number }>({ queryKey: [countUrl], enabled: countUrl !== null });
  const scopeCount = scopeMode === "selected" ? selectedCount : countQuery.data?.total ?? 0;

  const aiQuery = useQuery<{ maxBatchSize: number }>({ queryKey: ["/api/settings/ai"] });
  const maxBatch = aiQuery.data?.maxBatchSize ?? 5000;
  const overLimit = scopeCount > maxBatch;

  const runMutation = useMutation({
    mutationFn: () => apiRequest<{ id: number }>("POST", "/api/engine-runs", { engineType, screen, selection: effectiveSelection, params }),
    onSuccess: (run) => {
      setRunId(run.id);
      setUnlocked(1);
      setStep(1);
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "Run failed", description: err.message }),
  });

  const runStatusQuery = useQuery<{ status: string; processedItems: number; totalItems: number; cachedItems: number; errorItems: number }>({
    queryKey: [`/api/engine-runs/${runId}`],
    enabled: runId !== null && step >= 1,
    refetchInterval: (q) => (q.state.data?.status === "running" ? 800 : false),
  });
  const running = runStatusQuery.data?.status === "running";

  const itemsQuery = useQuery<RunItem[]>({
    queryKey: [`/api/engine-runs/${runId}/items`],
    enabled: runId !== null && step >= 1,
    refetchInterval: running ? 1200 : false,
  });
  const previewQuery = useQuery<Preview>({ queryKey: [`/api/engine-runs/${runId}/preview`], enabled: runId !== null && step === 2 });

  const cancelRunMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/engine-runs/${runId}/cancel`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/engine-runs/${runId}`] });
      toast({ title: "Cancelling run", description: "Partial results are kept staged; the catalog is untouched." });
    },
  });

  const patchItem = useMutation({
    mutationFn: (vars: { itemId: number; decision: string }) => apiRequest("PATCH", `/api/engine-runs/${runId}/items/${vars.itemId}`, { stewardDecision: vars.decision }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/engine-runs/${runId}/items`] }),
  });

  const bulkDecision = useMutation({
    mutationFn: (vars: { decision: string; filters?: Record<string, unknown> }) =>
      apiRequest("POST", `/api/engine-runs/${runId}/bulk-decision`, { selection: { mode: "all-matching", filters: vars.filters ?? {}, excluded: [] }, decision: vars.decision }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/engine-runs/${runId}/items`] }),
  });

  const approve = useMutation({
    mutationFn: () => apiRequest("POST", `/api/engine-runs/${runId}/approve`, { justification }),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries();
      toast({ title: "Committed to catalog", description: `${res.attributesChanged} attributes · ${res.detectionsWritten} detections · ${res.reviewItemsQueued} queued` });
      onClose();
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "Approval failed", description: err.message }),
  });

  const discard = useMutation({
    mutationFn: () => apiRequest("POST", `/api/engine-runs/${runId}/discard`),
    onSuccess: () => {
      toast({ title: "Run discarded", description: "No catalog changes were made." });
      onClose();
    },
  });

  const items = itemsQuery.data ?? [];
  const visibleItems = useMemo(() => {
    const filtered = items.filter((i) => (!onlyUncertain || i.verdict === "uncertain") && (!onlyConflicts || i.conflict));
    if (sortBy === "priority") return [...filtered].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.confidence - b.confidence);
    if (sortBy === "confidence") return [...filtered].sort((a, b) => a.confidence - b.confidence);
    return filtered;
  }, [items, onlyUncertain, onlyConflicts, sortBy]);

  const steps = [
    { key: "setup", label: lang === "ar" ? "الإعداد" : "Setup" },
    { key: "results", label: lang === "ar" ? "النتائج" : "Results" },
    { key: "review", label: lang === "ar" ? "المراجعة والاعتماد" : "Review & Approve" },
  ];

  return (
    <DialogPrimitive.Root open onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <DialogPrimitive.Content className="fixed start-1/2 top-1/2 z-50 flex max-h-[90vh] w-[95vw] max-w-5xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border bg-background shadow-lg">
          <div className="border-b p-4">
            <DialogPrimitive.Title className="mb-3 text-lg font-semibold">
              {engineType === "pii" ? (lang === "ar" ? "محرك كشف البيانات الشخصية" : "PII Detection Engine") : (lang === "ar" ? "محرك التصنيف" : "Classification Engine")}
            </DialogPrimitive.Title>
            <Stepper steps={steps} current={step} unlocked={unlocked} onStepClick={setStep} />
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {step === 0 && (
              <div className="space-y-4">
                {/* Panel A: framework (read-only, collapsed by default) */}
                <details className="rounded-md border">
                  <summary className="flex cursor-pointer items-center gap-2 p-3 text-sm">
                    <span className="font-semibold">{lang === "ar" ? "الإطار" : "Framework"}</span>
                    <span className="text-muted-foreground">
                      {framework.data?.version ?? "…"}
                      {engineType === "pii" && framework.data?.definition.criteria ? ` · ${framework.data.definition.criteria.length} ${lang === "ar" ? "معايير" : "criteria"}` : ""}
                      {framework.data?.definition.effective ? ` · effective ${framework.data.definition.effective}` : ""}
                    </span>
                    <a href="/pdtc/settings" className="ms-auto text-xs text-primary underline" onClick={(e) => e.stopPropagation()}>{lang === "ar" ? "الإعدادات" : "Settings"}</a>
                  </summary>
                  <div className="border-t p-3">
                  {engineType === "pii" ? (
                    <>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead><tr className="text-muted-foreground"><th className="p-1 text-start">Code</th><th className="p-1 text-start">Name</th><th className="p-1 text-start">Description</th><th className="p-1 text-start">Mode</th></tr></thead>
                          <tbody>
                            {framework.data?.definition.criteria?.map((c) => (
                              <tr key={c.code} className="border-t"><td className="p-1 font-mono">{c.code}</td><td className="p-1">{c.nameEn}</td><td className="p-1 text-muted-foreground">{c.description}</td><td className="p-1">{c.evaluationMode}</td></tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-2">
                        {framework.data?.definition.levels?.map((l) => <Badge key={l.code} variant="outline">{l.rank}. {l.labelEn}</Badge>)}
                      </div>
                      {framework.data?.definition.rules && framework.data.definition.rules.length > 0 && (
                        <details className="text-xs">
                          <summary className="cursor-pointer text-muted-foreground">{lang === "ar" ? "قواعد التصنيف" : "Classification rules"} ({framework.data.definition.rules.length})</summary>
                          <ul className="ms-4 mt-1 space-y-0.5">
                            {framework.data.definition.rules.map((r) => (
                              <li key={r.id}>
                                <span className="text-muted-foreground">
                                  {r.isSpecialCategory ? "special-category" : [r.criterion, r.verdict].filter(Boolean).join(" · ") || "any"}
                                </span>
                                {" → "}<span className="font-medium">{r.level}</span>
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                      {framework.data?.definition.rollup && (
                        <p className="text-xs text-muted-foreground">{lang === "ar" ? "قاعدة التجميع" : "Rollup precedence"}: {framework.data.definition.rollup}</p>
                      )}
                    </div>
                  )}
                  </div>
                </details>

                {/* Panel B: scope */}
                <section className="space-y-2 rounded-md border border-primary/20 bg-primary/5 p-3">
                  <div className="flex items-center gap-2 text-sm">
                    <Info className="h-4 w-4 text-muted-foreground" />
                    <span className="font-semibold">{lang === "ar" ? "النطاق" : "Scope"}</span>
                    <span className="ms-auto tabular-nums text-muted-foreground">{scopeCount.toLocaleString()} {lang === "ar" ? "سمة" : "attributes"}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {hasInitialSelection && (
                      <Button type="button" size="sm" variant={scopeMode === "selected" ? "default" : "outline"} onClick={() => setScopeMode("selected")}>
                        {lang === "ar" ? "المحدد" : "Selected"} ({selectedCount.toLocaleString()})
                      </Button>
                    )}
                    <Button type="button" size="sm" variant={scopeMode === "all" ? "default" : "outline"} onClick={() => setScopeMode("all")}>
                      {lang === "ar" ? "الكل" : "All"}
                    </Button>
                    <Button type="button" size="sm" variant={scopeMode === "remaining" ? "default" : "outline"} onClick={() => setScopeMode("remaining")}>
                      {engineType === "pii"
                        ? (lang === "ar" ? "المتبقّي (لم يُحلَّل)" : "Remaining (not analysed)")
                        : (lang === "ar" ? "المتبقّي (غير مصنّف)" : "Remaining (unclassified)")}
                    </Button>
                    <Button type="button" size="sm" variant={scopeMode === "filtered" ? "default" : "outline"} onClick={() => setScopeMode("filtered")}>
                      {lang === "ar" ? "تصفية / اختيار جداول" : "Filter / pick tables"}
                    </Button>
                  </div>
                  {scopeMode === "filtered" && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <p className="text-xs text-muted-foreground">
                          {lang === "ar"
                            ? "اختر جدولاً واحداً أو أكثر، أو قسّم حسب المجال / النوع / الحالة."
                            : "Pick one or more tables, or slice by domain / type / status."}
                        </p>
                        {Object.keys(scopeFilters).length > 0 && (
                          <button type="button" className="ms-auto text-xs text-muted-foreground underline hover:text-foreground" onClick={() => setScopeFilters({})}>
                            {lang === "ar" ? "مسح" : "Clear"}
                          </button>
                        )}
                      </div>
                      <FilterPanel
                        screen="attributes"
                        defs={SCOPE_FILTERS}
                        filters={scopeFilters}
                        onChange={(k, v) => setScopeFilters((f) => {
                          const next = { ...f };
                          if (v === undefined) delete next[k];
                          else next[k] = v;
                          return next;
                        })}
                        flat
                      />

                      {/* Table picklist — sorted by attribute count (main sort). Checking a table
                          adds it to the assetId scope filter; the list itself ignores that filter. */}
                      <div className="rounded-md border">
                        <div className="flex items-center gap-2 border-b bg-muted/30 px-2 py-1.5 text-xs">
                          <span className="font-medium">{lang === "ar" ? "الجداول" : "Tables"}</span>
                          <span className="text-muted-foreground">{(tablesQuery.data?.length ?? 0).toLocaleString()}</span>
                          {selectedTables.size > 0 && <span className="text-primary">· {selectedTables.size} {lang === "ar" ? "محدد" : "selected"}</span>}
                          <div className="ms-auto flex items-center gap-3">
                            {selectedTables.size > 0 && (
                              <button type="button" className="text-muted-foreground underline hover:text-foreground" onClick={() => setScopeFilters((f) => { const n = { ...f }; delete (n as Record<string, unknown>).assetId; return n; })}>
                                {lang === "ar" ? "مسح التحديد" : "Clear selection"}
                              </button>
                            )}
                            <button type="button" className="underline hover:text-foreground" onClick={() => setScopeFilters((f) => ({ ...f, assetId: (tablesQuery.data ?? []).map((t) => t.name) }))}>
                              {lang === "ar" ? "تحديد كل المعروض" : "Select all shown"}
                            </button>
                          </div>
                        </div>
                        <div className="max-h-64 overflow-y-auto">
                          <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-background text-muted-foreground">
                              <tr className="border-b">
                                <th className="w-8 p-1.5" />
                                <th className="cursor-pointer select-none p-1.5 text-start hover:text-foreground" onClick={() => sortTablesBy("name")}>
                                  {lang === "ar" ? "الجدول" : "Table"}{tableSort === "name" ? (tableDir === "asc" ? " ↑" : " ↓") : ""}
                                </th>
                                <th className="cursor-pointer select-none p-1.5 text-end hover:text-foreground" onClick={() => sortTablesBy("attributes")}>
                                  {lang === "ar" ? "الأعمدة" : "Columns"}{tableSort === "attributes" ? (tableDir === "asc" ? " ↑" : " ↓") : ""}
                                </th>
                                <th className="p-1.5 text-end">PII/{lang === "ar" ? "محلَّل" : "Analysed"}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(tablesQuery.data ?? []).map((t) => (
                                <tr key={t.id} className="cursor-pointer border-b hover:bg-muted/40" onClick={() => toggleTable(t.name)}>
                                  <td className="p-1.5"><Checkbox checked={selectedTables.has(t.name)} className="pointer-events-none" /></td>
                                  <td className="p-1.5">
                                    <span className="font-medium">{t.name}</span>
                                    {t.businessDomain && t.businessDomain.length > 0 && <span className="ms-1 text-muted-foreground">· {t.businessDomain.join(", ")}</span>}
                                  </td>
                                  <td className="p-1.5 text-end tabular-nums">{t.attributeCount.toLocaleString()}</td>
                                  <td className="p-1.5 text-end tabular-nums text-muted-foreground">{t.piiCount}/{t.analysedCount}</td>
                                </tr>
                              ))}
                              {tablesQuery.isLoading && <tr><td colSpan={4} className="p-4 text-center text-muted-foreground">…</td></tr>}
                              {!tablesQuery.isLoading && (tablesQuery.data?.length ?? 0) === 0 && (
                                <tr><td colSpan={4} className="p-4 text-center text-muted-foreground">{lang === "ar" ? "لا توجد جداول مطابقة" : "No matching tables"}</td></tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                        {(tablesQuery.data?.length ?? 0) >= 500 && (
                          <p className="border-t px-2 py-1 text-[11px] text-muted-foreground">{lang === "ar" ? "عرض أول 500 — ضيّق بالفلاتر أعلاه" : "Showing first 500 — narrow with the filters above"}</p>
                        )}
                      </div>
                    </div>
                  )}
                  {overLimit && (
                    <p className="text-xs text-destructive">
                      {lang === "ar"
                        ? `النطاق يتجاوز ${maxBatch.toLocaleString()} — ضيّق التحديد (الحد الأقصى لكل تشغيل؛ يُرفع من الإعدادات).`
                        : `Scope exceeds ${maxBatch.toLocaleString()} — narrow it. Up to ${maxBatch.toLocaleString()} columns per run; raise the limit in Settings.`}
                    </p>
                  )}
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={params.skipApproved} disabled={params.incremental} onCheckedChange={(v) => setParams((p) => ({ ...p, skipApproved: v === true }))} />
                    {lang === "ar" ? "تخطي العناصر المعتمدة مسبقاً" : "Skip items already approved"}
                  </label>
                  {engineType === "pii" && (
                    <>
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox checked={params.incremental} onCheckedChange={(v) => setParams((p) => ({ ...p, incremental: v === true }))} />
                        {lang === "ar" ? "فقط الجديد/المتغيّر منذ آخر فحص" : "Only new/changed since last scan"}
                        <span className="text-xs text-muted-foreground">{lang === "ar" ? "(يتخطّى الأعمدة التي لم تتغيّر مدخلاتها)" : "(skips columns whose input is unchanged)"}</span>
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox checked={params.publishConfident} onCheckedChange={(v) => setParams((p) => ({ ...p, publishConfident: v === true }))} />
                        {lang === "ar" ? "انشر النتائج الواثقة الآن" : "Publish confident results now"}
                        <span className="text-xs text-muted-foreground">{lang === "ar" ? "(تظهر في الكتالوج دون اعتماد)" : "(visible in the catalog without approving)"}</span>
                      </label>
                    </>
                  )}
                </section>

                {/* Panel C: essentials — strictness + run note */}
                <section className="space-y-3">
                  <div>
                    <p className="mb-1.5 text-sm font-medium">{lang === "ar" ? "مستوى الصرامة" : "Strictness"}</p>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" variant={strictness === "balanced" ? "default" : "outline"} onClick={() => applyStrictness("balanced")}>
                        {lang === "ar" ? "متوازن (موصى به)" : "Balanced (recommended)"}
                      </Button>
                      <Button type="button" size="sm" variant={strictness === "strict" ? "default" : "outline"} onClick={() => applyStrictness("strict")}>
                        {lang === "ar" ? "صارم" : "Strict"}
                      </Button>
                      <Button type="button" size="sm" variant={strictness === "lenient" ? "default" : "outline"} onClick={() => applyStrictness("lenient")}>
                        {lang === "ar" ? "متساهل" : "Lenient"}
                      </Button>
                    </div>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {strictness === "custom"
                        ? (lang === "ar" ? "عتبات مخصّصة (من الخيارات المتقدمة)." : "Custom thresholds — set in Advanced.")
                        : (lang === "ar"
                            ? `قبول تلقائي عند ثقة ≥ ${Math.round(params.confidenceThreshold * 100)}%؛ الباقي يُرسَل إلى المراجعة.`
                            : `Auto-accept at ≥ ${Math.round(params.confidenceThreshold * 100)}% confidence; everything below goes to review.`)}
                    </p>
                  </div>
                  <Field label={lang === "ar" ? "ملاحظة التشغيل" : "Run note"}>
                    <Input value={params.runNote} onChange={(e) => setParams((p) => ({ ...p, runNote: e.target.value }))} placeholder={lang === "ar" ? "لتمييز هذا التشغيل لاحقاً" : "Label this run so you can find it later"} />
                  </Field>
                </section>

                {/* Advanced options (collapsed) */}
                <details className="rounded-md border">
                  <summary className="cursor-pointer p-3 text-sm text-muted-foreground">{lang === "ar" ? "خيارات متقدمة" : "Advanced options"}</summary>
                  <div className="space-y-3 border-t p-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label={lang === "ar" ? "عتبة القبول التلقائي" : "Auto-accept threshold"}>
                        <Input type="number" step="0.05" min="0" max="1" value={params.confidenceThreshold} onChange={(e) => { setParams((p) => ({ ...p, confidenceThreshold: Number(e.target.value) })); setStrictness("custom"); }} />
                      </Field>
                      <Field label={lang === "ar" ? "الحد الأدنى للثقة" : "Confidence floor"}>
                        <Input type="number" step="0.05" min="0" max="1" value={params.confidenceFloor} onChange={(e) => { setParams((p) => ({ ...p, confidenceFloor: Number(e.target.value) })); setStrictness("custom"); }} />
                      </Field>
                      <Field label={lang === "ar" ? "حجم الدفعة" : "Batch size"}>
                        <Input type="number" min="1" max="50" value={params.batchSize} onChange={(e) => setParams((p) => ({ ...p, batchSize: Number(e.target.value) }))} />
                      </Field>
                      <Field label={lang === "ar" ? "عينات الاتساق الذاتي" : "Self-consistency samples"}>
                        <Input type="number" min="1" max="9" value={params.selfConsistencySamples} onChange={(e) => setParams((p) => ({ ...p, selfConsistencySamples: Number(e.target.value) }))} />
                      </Field>
                    </div>
                    <div className="flex flex-wrap items-center gap-4">
                      <label className="flex items-center gap-2 text-sm"><Checkbox checked={params.includeArabic} onCheckedChange={(v) => setParams((p) => ({ ...p, includeArabic: v === true }))} /> {lang === "ar" ? "مبرر عربي" : "Arabic rationale"}</label>
                      <label className="flex items-center gap-2 text-sm"><Checkbox checked={params.useCache} onCheckedChange={(v) => setParams((p) => ({ ...p, useCache: v === true, forceFresh: v === true ? p.forceFresh : false }))} /> {lang === "ar" ? "استخدام المخزّن" : "Use cache"}</label>
                      <label className="flex items-center gap-2 text-sm"><Checkbox checked={params.forceFresh} disabled={!params.useCache} onCheckedChange={(v) => setParams((p) => ({ ...p, forceFresh: v === true }))} /> {lang === "ar" ? "تحديث إجباري" : "Force fresh"}</label>
                      {engineType === "pii" && (
                        <label className="flex items-center gap-2 text-sm" title={lang === "ar" ? "تجريبي — عدة أعمدة لكل نداء" : "Experimental — several columns per LLM call (faster/cheaper)"}>
                          <Checkbox checked={params.batchInference} onCheckedChange={(v) => setParams((p) => ({ ...p, batchInference: v === true }))} /> {lang === "ar" ? "استدلال مجمّع (تجريبي)" : "Batch inference (experimental)"}
                        </label>
                      )}
                    </div>
                    {engineType === "pii" && (
                      <div>
                        <p className="mb-1 text-sm font-medium">{lang === "ar" ? "المعايير المراد تقييمها" : "Criteria to evaluate"}</p>
                        <div className="flex flex-wrap gap-2">
                          {CRITERION_CODES.map((c) => (
                            <label key={c} className="flex items-center gap-1.5 text-xs">
                              <Checkbox checked={params.criteria.includes(c)} onCheckedChange={(v) => setParams((p) => ({ ...p, criteria: v === true ? [...p.criteria, c] : p.criteria.filter((x) => x !== c) }))} />
                              {c}
                            </label>
                          ))}
                        </div>
                        {params.criteria.length < CRITERION_CODES.length && (
                          <p className="mt-1 text-xs text-warning">{lang === "ar" ? "تشغيل جزئي لا يُعد دليلاً على التغطية الكاملة." : "A partial run cannot be used as evidence of full policy coverage."}</p>
                        )}
                      </div>
                    )}
                  </div>
                </details>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-3">
                {runStatusQuery.data && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {runStatusQuery.data.processedItems} / {runStatusQuery.data.totalItems} {lang === "ar" ? "تم تقييمها" : "assessed"} · {runStatusQuery.data.errorItems} {lang === "ar" ? "أخطاء" : "errors"} · {runStatusQuery.data.cachedItems} {lang === "ar" ? "مخزّنة" : "cached"}
                      </span>
                      {running && (
                        <Button size="sm" variant="ghost" onClick={() => cancelRunMutation.mutate()}>{lang === "ar" ? "إلغاء التشغيل" : "Cancel run"}</Button>
                      )}
                    </div>
                    <Progress value={runStatusQuery.data.totalItems > 0 ? Math.round((runStatusQuery.data.processedItems / runStatusQuery.data.totalItems) * 100) : 0} />
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" disabled={running} onClick={() => bulkDecision.mutate({ decision: "accept", filters: { minConfidence: params.confidenceThreshold } })}>{lang === "ar" ? `قبول ≥ ${params.confidenceThreshold}` : `Accept ≥ ${params.confidenceThreshold}`}</Button>
                  <Button size="sm" variant="outline" disabled={running} onClick={() => bulkDecision.mutate({ decision: "reject", filters: { maxConfidence: params.confidenceFloor } })}>{lang === "ar" ? `رفض ≤ ${params.confidenceFloor}` : `Reject ≤ ${params.confidenceFloor}`}</Button>
                  <Button size="sm" variant="ghost" disabled={running} onClick={() => bulkDecision.mutate({ decision: "accept" })}>{lang === "ar" ? "قبول الكل" : "Accept all"}</Button>
                  <label className="ms-2 flex items-center gap-2 text-sm"><Checkbox checked={onlyUncertain} onCheckedChange={(v) => setOnlyUncertain(v === true)} /> {lang === "ar" ? "غير المؤكد" : "Uncertain"}</label>
                  <label className="flex items-center gap-2 text-sm"><Checkbox checked={onlyConflicts} onCheckedChange={(v) => setOnlyConflicts(v === true)} /> {lang === "ar" ? "المتعارض فقط" : "Conflicts only"}</label>
                  <label className="flex items-center gap-1.5 text-sm">
                    <span className="text-xs text-muted-foreground">{lang === "ar" ? "ترتيب" : "Sort"}</span>
                    <select className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}>
                      <option value="default">{lang === "ar" ? "افتراضي" : "Default"}</option>
                      <option value="priority">{lang === "ar" ? "الأولوية (الأخطر أولاً)" : "Priority (riskiest first)"}</option>
                      <option value="confidence">{lang === "ar" ? "الأقل ثقة أولاً" : "Lowest confidence"}</option>
                    </select>
                  </label>
                  <span className="ms-auto text-sm text-muted-foreground">{items.length} {lang === "ar" ? "نتيجة" : "results"}</span>
                </div>
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="text-muted-foreground">
                      <tr className="border-b"><th className="p-2 text-start">Column</th><th className="p-2 text-start">{engineType === "pii" ? "Verdict" : "Level"}</th><th className="p-2 text-start">Suggested</th><th className="p-2 text-start">Confidence</th><th className="p-2 text-start">Source</th><th className="p-2 text-start">Decision</th></tr>
                    </thead>
                    <tbody>
                      {visibleItems.map((item) => <ResultRow key={item.id} item={item} engineType={engineType} lang={lang} onDecision={(d) => patchItem.mutate({ itemId: item.id, decision: d })} />)}
                      {visibleItems.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">{itemsQuery.isLoading ? "…" : "No staged results"}</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {step === 2 && previewQuery.data && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label={lang === "ar" ? "PII" : "Marked PII"} value={previewQuery.data.markedPii} />
                  <Stat label={lang === "ar" ? "ليست PII" : "Not PII"} value={previewQuery.data.markedNotPii} />
                  <Stat label={lang === "ar" ? "بانتظار المراجعة" : "Queued"} value={previewQuery.data.uncertainQueued} />
                  <Stat label={lang === "ar" ? "دون تغيير" : "Unchanged"} value={previewQuery.data.unchanged} />
                </div>
                {previewQuery.data.assetRollups.length > 0 && (
                  <div>
                    <h4 className="mb-1 text-sm font-semibold">{lang === "ar" ? "تغيّرات تجميع الأصول" : "Asset rollup changes"}</h4>
                    {previewQuery.data.assetRollups.map((r) => (
                      <div key={r.assetId} className="flex items-center gap-2 text-sm"><span>Asset #{r.assetId}</span><ClassificationBadge code={r.currentLevel as any} /><ChevronRight className="h-3 w-3" /><ClassificationBadge code={r.newLevel as any} /><span className="text-xs text-muted-foreground">({r.driver})</span></div>
                    ))}
                  </div>
                )}
                <div className="max-h-48 overflow-y-auto rounded-md border">
                  <table className="w-full text-xs">
                    <thead className="text-muted-foreground"><tr className="border-b"><th className="p-2 text-start">Column</th><th className="p-2 text-start">Field</th><th className="p-2 text-start">Current</th><th className="p-2 text-start">New</th></tr></thead>
                    <tbody>
                      {previewQuery.data.diffs.map((d, i) => <tr key={i} className="border-t"><td className="p-2">{d.columnName}</td><td className="p-2">{d.field}</td><td className="p-2 text-muted-foreground">{d.currentValue}</td><td className="p-2 font-medium">{d.newValue}</td></tr>)}
                    </tbody>
                  </table>
                </div>
                <div className="space-y-1.5">
                  <Label>{lang === "ar" ? "مبرر التشغيل (10 أحرف على الأقل)" : "Run justification (min 10 chars) *"}</Label>
                  <Textarea value={justification} onChange={(e) => setJustification(e.target.value)} rows={2} />
                </div>
                <Alert tone="info" title={lang === "ar" ? "لن يُكتب شيء في الكتالوج حتى الاعتماد." : "Nothing is written to the catalog until you approve."}>
                  <span className="inline-flex items-center gap-1"><Info className="h-3 w-3" /> Framework {framework.data?.version}</span>
                </Alert>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between border-t p-4">
            <Button variant="ghost" onClick={() => (runId ? discard.mutate() : onClose())}>{runId ? (lang === "ar" ? "تجاهل" : "Discard run") : (lang === "ar" ? "إلغاء" : "Cancel")}</Button>
            <div className="flex gap-2">
              {step > 0 && <Button variant="outline" onClick={() => setStep(step - 1)}>{lang === "ar" ? "رجوع" : "Back"}</Button>}
              {step === 0 && <Btn loading={runMutation.isPending} disabled={overLimit || scopeCount === 0} onClick={() => runMutation.mutate()}>{lang === "ar" ? "تشغيل" : "Run"}</Btn>}
              {step === 1 && <Button disabled={running} onClick={() => { setUnlocked(2); setStep(2); }}>{lang === "ar" ? "التالي" : "Next"}</Button>}
              {step === 2 && <Btn variant="destructive" loading={approve.isPending} disabled={justification.trim().length < 10} onClick={() => approve.mutate()}>{lang === "ar" ? "اعتماد والتزام" : "Approve & commit"}</Btn>}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Review-priority chip for the riskiest items; confident items show none (less clutter). */
function priorityMeta(priority: number | undefined, lang: string): { label: string; className: string } | null {
  if (priority === undefined) return null;
  if (priority >= 100) return { label: lang === "ar" ? "تعارض" : "Conflict", className: "bg-destructive/15 text-destructive" };
  if (priority >= 80) return { label: lang === "ar" ? "غير مؤكد" : "Uncertain", className: "bg-warning/15 text-warning" };
  if (priority >= 60) return { label: lang === "ar" ? "حدّي" : "Borderline", className: "bg-warning/10 text-warning" };
  return null;
}

function ResultRow({ item, engineType, lang, onDecision }: { item: RunItem; engineType: string; lang: string; onDecision: (d: string) => void }) {
  const [open, setOpen] = useState(false);
  const layers = item.sourceLayers ?? [];
  const prio = priorityMeta(item.priority, lang);
  // Classification only: the governance floor lifted the level above the model's own call.
  const floorRaised = engineType === "classification" && layers.includes("rule_floor");
  const existingLevel = item.currentValue?.columnDataClassification ?? null;
  const floorHint = lang === "ar" ? "رُفع فوق تقييم النموذج بواسطة الحد الأدنى للحوكمة" : "Raised above the model's assessment by the governance floor";
  return (
    <>
      <tr className="border-b">
        <td className="p-2">
          <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 font-medium">
            <ChevronRight className={cn("h-3 w-3 transition", open && "rotate-90")} />
            {item.columnName}
            {prio && <span className={cn("rounded px-1 py-0.5 text-[10px] font-medium", prio.className)}>{prio.label}</span>}
          </button>
          <span className="ms-4 block text-xs text-muted-foreground">{item.assetName}</span>
        </td>
        <td className="p-2">
          {engineType === "pii" ? (
            item.verdict ? <VerdictPill verdict={item.verdict as any} /> : "—"
          ) : (
            <span className="inline-flex items-center gap-1">
              <ClassificationBadge code={item.suggestedLevelCode as any} />
              {floorRaised && <ArrowUp className="h-3.5 w-3.5 text-info" aria-label={floorHint}><title>{floorHint}</title></ArrowUp>}
            </span>
          )}
        </td>
        <td className="p-2 text-xs">{item.suggestedClassCode ?? "—"}</td>
        <td className="p-2"><ConfidenceBar value={item.confidence} /></td>
        <td className="p-2">
          <div className="flex flex-wrap items-center gap-1">
            {layers.map((l) => <span key={l} className="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">{layerLabel(l, lang)}</span>)}
            {item.conflict && <TriangleAlert className="h-3.5 w-3.5 text-warning" />}
          </div>
        </td>
        <td className="p-2">
          <select className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={item.stewardDecision} onChange={(e) => onDecision(e.target.value)}>
            <option value="accept">Accept</option>
            <option value="reject">Reject</option>
            <option value="override">Override</option>
            <option value="pending">Pending</option>
          </select>
        </td>
      </tr>
      {open && (
        <tr className="bg-muted/30">
          <td colSpan={6} className="space-y-2 p-3">
            {engineType === "pii" ? (
              <table className="w-full text-xs">
                <thead className="text-muted-foreground"><tr><th className="p-1 text-start">Criterion</th><th className="p-1 text-start">Applies</th><th className="p-1 text-start">Reasoning (EN)</th><th className="p-1 text-start">Reasoning (AR)</th><th className="p-1 text-start">Conf.</th></tr></thead>
                <tbody>
                  {item.assessments.map((a) => (
                    <tr key={a.criterionCode} className="border-t">
                      <td className="p-1">{isCriterionCode(a.criterionCode) ? <CriterionBadge code={a.criterionCode} /> : a.criterionCode}</td>
                      <td className="p-1">{a.applies ? <Badge variant="success">Yes</Badge> : <Badge variant="outline">No</Badge>}</td>
                      <td className="p-1">{a.rationaleEn}</td>
                      <td className="p-1 text-end" dir="rtl">{a.rationaleAr}</td>
                      <td className="p-1 tabular-nums">{Math.round(a.confidence * 100)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              // Classification: show HOW the level was derived — existing catalog level, the
              // contributing layers, and (when the floor lifted it) an explicit note.
              <div className="space-y-1.5 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{lang === "ar" ? "اشتقاق المستوى" : "Level derivation"}:</span>
                  {isClassificationCode(existingLevel ?? "") && (
                    <span className="inline-flex items-center gap-1">
                      <span className="text-muted-foreground">{lang === "ar" ? "الحالي" : "Current"}</span>
                      <ClassificationBadge code={existingLevel as any} />
                      <ChevronRight className="h-3 w-3 text-muted-foreground" />
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1">
                    <span className="text-muted-foreground">{lang === "ar" ? "المقترح" : "Suggested"}</span>
                    <ClassificationBadge code={item.suggestedLevelCode as any} />
                  </span>
                  {layers.map((l) => <span key={l} className="rounded bg-secondary px-1.5 py-0.5 text-[10px]">{layerLabel(l, lang)}</span>)}
                </div>
                {floorRaised && (
                  <p className="flex items-start gap-1 text-info">
                    <ArrowUp className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>{floorHint}.</span>
                  </p>
                )}
              </div>
            )}
            {(item.rationaleEn || item.rationaleAr) && (
              <p className="text-xs">
                <span className="font-medium">{lang === "ar" ? "المبرر العام" : "Overall rationale"}: </span>
                {lang === "ar" ? item.rationaleAr : item.rationaleEn}
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={cn("space-y-1", className)}><Label className="text-xs">{label}</Label>{children}</div>;
}
function Stat({ label, value }: { label: string; value: number }) {
  return <div className="rounded-md border p-2 text-center"><p className="text-xl font-semibold tabular-nums">{value}</p><p className="text-xs text-muted-foreground">{label}</p></div>;
}
