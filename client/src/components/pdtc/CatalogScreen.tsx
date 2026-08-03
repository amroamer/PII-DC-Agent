import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown, Columns3, Download, Filter as FilterIcon, Radar, Search, Tag, Trash2, TriangleAlert, X } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLanguage } from "@/hooks/useLanguage";
import { useToast } from "@/hooks/use-toast";
import { useCatalogState } from "@/hooks/useCatalogState";
import { useSelection } from "@/hooks/useSelection";
import {
  FILTERS_BY_SCREEN,
  type CatalogScreen as Screen,
} from "@shared/lib/filter-defs";
import { displayPiiType, isConfidenceNotable, oneLine } from "@shared/lib/detection-view";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Btn } from "./Btn";
import { EngineWizard } from "./EngineWizard";
import { ExportDialog } from "./ExportDialog";
import { AssetImport } from "./AssetImport";
import { ClassificationBadge } from "./ClassificationBadge";
import { CriterionBadge } from "./CriterionBadge";
import { ConfidenceBar } from "./ConfidenceBar";
import { VerdictPill } from "./Pill";
import { Modal } from "./Modal";
import { AssetDetailDrawer } from "./AssetDetailDrawer";
import { AttributeDetailDrawer } from "./AttributeDetailDrawer";
import { FilterPanel } from "./FilterPanel";
import { cn } from "@/lib/utils";

interface ListResponse {
  rows: Array<Record<string, unknown> & { id: number }>;
  total: number;
  page: number;
  pageSize: number;
}

function toQuery(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") sp.set(k, String(v));
  return sp.toString();
}

export function CatalogScreen({ screen }: { screen: Screen }) {
  const { t, lang } = useLanguage();
  const { state, effectiveFilters, patchFilter, setSearch, setSort, setPage, clearFilters } = useCatalogState(screen);
  const [showFilters, setShowFilters] = useState(false);
  const [wizard, setWizard] = useState<null | "pii" | "classification">(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [wipeOpen, setWipeOpen] = useState(false);
  const [wipeConfirm, setWipeConfirm] = useState("");
  const [detailId, setDetailId] = useState<number | null>(null);
  const [attrFromAsset, setAttrFromAsset] = useState<number | null>(null);

  const filtersJson = JSON.stringify(effectiveFilters);
  const listUrl = `/api/catalog/${screen}?${toQuery({ filters: filtersJson, sort: state.sort, dir: state.dir, page: state.page, pageSize: state.pageSize })}`;
  const kpiUrl = `/api/catalog/kpis?${toQuery({ screen, filters: filtersJson })}`;

  const listQuery = useQuery<ListResponse>({ queryKey: [listUrl] });
  const kpiQuery = useQuery<KpiData>({ queryKey: [kpiUrl] });

  const rows = listQuery.data?.rows ?? [];
  const total = listQuery.data?.total ?? 0;
  const pageIds = rows.map((r) => r.id);
  const sel = useSelection(effectiveFilters);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => sel.isSelected(id));
  const selectedCount = sel.count(total);

  const { toast } = useToast();
  const defs = FILTERS_BY_SCREEN[screen];
  // Chips are derived from the ACTIVE FILTER STATE, not from the visible filter
  // defs. A filter can be applied by something other than the panel — a KPI card,
  // a saved view, a criteria-distribution bar — and if no chip rendered for it the
  // user would have no way to see or clear it.
  const activeChips = Object.keys(effectiveFilters)
    .filter((key) => key !== "search" && effectiveFilters[key] !== undefined)
    .map((key) => defs.find((d) => d.key === key) ?? { key, labelEn: key, labelAr: key });
  const columns = useMemo(() => columnsFor(screen), [screen]);
  const totalPages = Math.max(1, Math.ceil(total / state.pageSize));

  // Per-user column visibility (§2.3). Until prefs are saved, columns marked
  // defaultHidden stay out of the way.
  const colPrefsQuery = useQuery<{ columns: string[] | null }>({ queryKey: [`/api/settings/columns?screen=${screen}`] });
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(() => new Set(columnsFor(screen).filter((c) => c.defaultHidden).map((c) => c.key)));
  useEffect(() => {
    const saved = colPrefsQuery.data?.columns;
    setHiddenCols(
      saved
        ? new Set(columns.map((c) => c.key).filter((k) => !saved.includes(k)))
        : new Set(columns.filter((c) => c.defaultHidden).map((c) => c.key)),
    );
  }, [colPrefsQuery.data, columns]);
  const visibleColumns = columns.filter((c) => !hiddenCols.has(c.key));

  const saveColPrefs = useMutation({ mutationFn: (cols: string[]) => apiRequest("PUT", `/api/settings/columns?screen=${screen}`, { columns: cols }) });
  const toggleCol = (key: string) =>
    setHiddenCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveColPrefs.mutate(columns.map((c) => c.key).filter((k) => !next.has(k)));
      return next;
    });
  const bulkActionMutation = useMutation({
    mutationFn: (vars: { action: string; value: string }) => apiRequest<{ changed: number }>("POST", "/api/catalog/bulk-action", { screen, action: vars.action, value: vars.value, selection: sel.selection }),
    onSuccess: (res) => {
      queryClient.invalidateQueries();
      toast({ title: `${res.changed} assets updated` });
      sel.clear();
    },
  });
  const promptBulkAction = (action: string, label: string) => {
    const v = window.prompt(label);
    if (v) bulkActionMutation.mutate({ action, value: v });
  };
  const wipeMutation = useMutation({
    mutationFn: () => apiRequest<{ deleted: { assets: number; attributes: number } }>("POST", "/api/catalog/wipe"),
    onSuccess: (res) => {
      queryClient.invalidateQueries();
      sel.clear();
      setWipeOpen(false);
      setWipeConfirm("");
      toast({ title: lang === "ar" ? "تم حذف جميع البيانات" : "All data deleted", description: `${res.deleted.assets} assets · ${res.deleted.attributes} attributes` });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: lang === "ar" ? "فشل الحذف" : "Wipe failed", description: err.message }),
  });

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <KpiStrip screen={screen} kpis={kpiQuery.data} onApply={(k, v) => patchFilter(k, v)} />

      {/* Search + filter + export toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={state.search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={lang === "ar" ? "بحث…" : "Search…"}
            className="ps-9"
          />
        </div>
        <Button variant="outline" onClick={() => setShowFilters((v) => !v)}>
          <FilterIcon className="h-4 w-4" /> {lang === "ar" ? "المرشحات" : "Filters"}
          {activeChips.length > 0 && <Badge variant="secondary" className="ms-1">{activeChips.length}</Badge>}
        </Button>
        {/* Column visibility */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline"><Columns3 className="h-4 w-4" /> {lang === "ar" ? "الأعمدة" : "Columns"}</Button>
          </PopoverTrigger>
          <PopoverContent className="w-56">
            {columns.map((c) => (
              <label key={c.key} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent">
                <Checkbox checked={!hiddenCols.has(c.key)} onCheckedChange={() => toggleCol(c.key)} />
                {lang === "ar" ? c.headerAr : c.header}
              </label>
            ))}
          </PopoverContent>
        </Popover>
        <Button variant="outline" onClick={() => setExportOpen(true)}>
          <Download className="h-4 w-4" /> {lang === "ar" ? "تصدير" : "Export"}
        </Button>
        <AssetImport />
      </div>

      {/* Active chips */}
      {activeChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {activeChips.map((d) => (
            <Badge key={d.key} variant="secondary" className="gap-1">
              {lang === "ar" ? d.labelAr : d.labelEn}: {formatFilterValue(effectiveFilters[d.key])}
              <button type="button" onClick={() => patchFilter(d.key, undefined)} aria-label="remove">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          <Button variant="ghost" size="sm" onClick={clearFilters}>{lang === "ar" ? "مسح الكل" : "Clear all"}</Button>
        </div>
      )}

      {/* Filter panel */}
      {showFilters && <FilterPanel screen={screen} defs={defs} filters={effectiveFilters} onChange={patchFilter} />}

      {/* Bulk action bar */}
      {sel.hasSelection && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="flex flex-wrap items-center gap-2 py-3">
            <span className="text-sm font-medium">{selectedCount} {lang === "ar" ? "محدد" : "selected"}</span>
            <div className="flex-1" />
            <Btn size="sm" icon={<Radar className="h-4 w-4" />} onClick={() => setWizard("pii")}>{lang === "ar" ? "كشف البيانات الشخصية" : "Identify PII"}</Btn>
            <Btn size="sm" variant="secondary" icon={<Tag className="h-4 w-4" />} onClick={() => setWizard("classification")}>{lang === "ar" ? "تصنيف" : "Classify"}</Btn>
            <Button size="sm" variant="outline" onClick={() => setExportOpen(true)}><Download className="h-4 w-4" /> {lang === "ar" ? "تصدير" : "Export"}</Button>
            <Button size="sm" variant="outline" onClick={() => promptBulkAction("assign-steward", lang === "ar" ? "اسم أمين البيانات" : "Steward name")}>{lang === "ar" ? "إسناد أمين" : "Assign steward"}</Button>
            <Button size="sm" variant="outline" onClick={() => promptBulkAction("add-tag", lang === "ar" ? "الوسم" : "Tag")}>{lang === "ar" ? "إضافة وسم" : "Add tag"}</Button>
            <Button size="sm" variant="destructive" onClick={() => setWipeOpen(true)}><Trash2 className="h-4 w-4" /> {lang === "ar" ? "حذف الكل" : "Delete all"}</Button>
            <Button size="sm" variant="ghost" onClick={sel.clear}>{lang === "ar" ? "إلغاء" : "Clear"}</Button>
          </CardContent>
        </Card>
      )}

      <Modal
        open={wipeOpen}
        onOpenChange={(o) => { if (!o) { setWipeOpen(false); setWipeConfirm(""); } }}
        title={lang === "ar" ? "حذف كل البيانات" : "Delete all data"}
        description={lang === "ar"
          ? "سيؤدي هذا إلى حذف جميع الأصول والسمات ونتائج الكشف والتصنيف نهائياً — بغض النظر عن التحديد الحالي. لا يمكن التراجع عن ذلك."
          : "This permanently deletes ALL assets, attributes, PII detections and classifications — regardless of your current selection. This cannot be undone."}
        footer={
          <>
            <Button variant="outline" onClick={() => { setWipeOpen(false); setWipeConfirm(""); }}>{lang === "ar" ? "إلغاء" : "Cancel"}</Button>
            <Btn variant="destructive" loading={wipeMutation.isPending} disabled={wipeConfirm !== "DELETE"} onClick={() => wipeMutation.mutate()}>
              {lang === "ar" ? "حذف كل شيء" : "Delete everything"}
            </Btn>
          </>
        }
      >
        <div className="space-y-2">
          <p className="text-sm">{lang === "ar" ? "اكتب DELETE للتأكيد." : "Type DELETE to confirm."}</p>
          <Input value={wipeConfirm} onChange={(e) => setWipeConfirm(e.target.value)} placeholder="DELETE" />
          <p className="text-xs text-muted-foreground">
            {lang === "ar"
              ? "يبقى: المستخدمون، الأطر، فئات البيانات، الإعدادات، العروض المحفوظة، وسجل التدقيق."
              : "Kept: users, frameworks, data classes, settings, saved views, and the audit log."}
          </p>
        </div>
      </Modal>

      {/* Select-all-matching banner */}
      {allPageSelected && sel.selection.mode === "include" && total > pageIds.length && (
        <div className="rounded-md border bg-accent p-2 text-center text-sm">
          {lang === "ar" ? `تم تحديد ${pageIds.length} في هذه الصفحة — ` : `All ${pageIds.length} on this page are selected — `}
          <button type="button" className="font-semibold text-primary underline" onClick={sel.selectAllMatching}>
            {lang === "ar" ? `حدد جميع ${total} صفاً` : `Select all ${total} matching rows`}
          </button>
        </div>
      )}

      {/* Table */}
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allPageSelected ? true : selectedCount > 0 ? "indeterminate" : false}
                  onCheckedChange={() => sel.togglePage(pageIds, allPageSelected)}
                  aria-label="select page"
                />
              </TableHead>
              {visibleColumns.map((c) => (
                <TableHead key={c.key}>
                  <button
                    type="button"
                    className={cn("flex items-center gap-1", c.sortable && "hover:text-foreground")}
                    onClick={() => c.sortable && setSort(c.key, state.sort === c.key && state.dir === "asc" ? "desc" : "asc")}
                    disabled={!c.sortable}
                  >
                    {lang === "ar" ? c.headerAr : c.header}
                    {c.sortable && state.sort === c.key && <ChevronDown className={cn("h-3 w-3", state.dir === "desc" && "rotate-180")} />}
                  </button>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} className="cursor-pointer" onClick={() => setDetailId(row.id)} data-state={sel.isSelected(row.id) ? "selected" : undefined}>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Checkbox checked={sel.isSelected(row.id)} onCheckedChange={() => sel.toggle(row.id)} aria-label={`select ${row.id}`} />
                </TableCell>
                {visibleColumns.map((c) => (
                  <TableCell key={c.key}>{c.render ? c.render(row) : String(row[c.key] ?? "—")}</TableCell>
                ))}
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={visibleColumns.length + 1} className="py-10 text-center text-muted-foreground">
                  {listQuery.isLoading ? t("common.loading") : lang === "ar" ? "لا توجد نتائج" : "No results"}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          {rows.length > 0
            ? `${(state.page - 1) * state.pageSize + 1}–${(state.page - 1) * state.pageSize + rows.length} ${lang === "ar" ? "من" : "of"} ${total}`
            : "0"}
        </span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={state.page <= 1} onClick={() => setPage(state.page - 1)}>{lang === "ar" ? "السابق" : "Previous"}</Button>
          <span className="tabular-nums">{state.page} / {totalPages}</span>
          <Button variant="outline" size="sm" disabled={state.page >= totalPages} onClick={() => setPage(state.page + 1)}>{lang === "ar" ? "التالي" : "Next"}</Button>
        </div>
      </div>

      {wizard && (
        <EngineWizard
          engineType={wizard}
          screen={screen}
          selection={sel.selection}
          selectedCount={selectedCount}
          onClose={() => setWizard(null)}
        />
      )}
      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        screen={screen}
        filters={effectiveFilters}
        selection={sel.hasSelection ? sel.selection : undefined}
      />

      {/* Row-click detail drawers */}
      {screen === "assets" ? (
        <>
          <AssetDetailDrawer id={detailId} onClose={() => setDetailId(null)} onOpenAttribute={setAttrFromAsset} />
          <AttributeDetailDrawer id={attrFromAsset} onClose={() => setAttrFromAsset(null)} />
        </>
      ) : (
        <AttributeDetailDrawer id={detailId} onClose={() => setDetailId(null)} />
      )}
    </div>
  );
}

// --- KPI strip ------------------------------------------------------------
const LEVEL_BAR_COLOR: Record<string, string> = {
  OPEN: "bg-success",
  CONFIDENTIAL: "bg-blue-500",
  SENSITIVE: "bg-warning",
  SECRET: "bg-destructive",
  UNCLASSIFIED: "bg-border",
};

interface KpiData extends Record<string, unknown> {
  classificationDistribution?: Record<string, number>;
  criteriaDistribution?: Record<string, number>;
}

function KpiStrip({
  screen,
  kpis,
  onApply,
}: {
  screen: Screen;
  kpis?: KpiData;
  onApply: (key: string, value: unknown) => void;
}) {
  const { lang } = useLanguage();
  if (!kpis) {
    // Loading skeleton — keeps the strip visible instead of vanishing while the
    // aggregates load, which on large catalogs used to make the KPIs look gone.
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-lg border bg-muted/40" />
        ))}
      </div>
    );
  }
  const n = (k: string) => Number(kpis[k] ?? 0);
  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

  const cards =
    screen === "attributes"
      ? [
          { label: lang === "ar" ? "في العرض" : "In view", value: `${n("inView")}`, sub: `${lang === "ar" ? "من" : "of"} ${n("total")}` },
          { label: "PII", value: `${n("pii")}`, sub: `${pct(n("pii"), n("analysed"))}%`, apply: () => onApply("verdict", ["pii"]) },
          { label: lang === "ar" ? "فئة خاصة" : "Special", value: `${n("specialCategory")}`, apply: () => onApply("specialCategory", true) },
          // Coverage, measured over the filters MINUS the verdict facet, so the
          // two numbers always sum to the selected catalog. Scoped to the
          // verdict-filtered view it was circular — picking pii/not_pii/uncertain
          // excludes un-analysed columns by construction, so it read "0 never".
          { label: lang === "ar" ? "محلّلة" : "Analysed", value: `${n("analysed")}`, sub: `${n("notAnalysed")} ${lang === "ar" ? "لم تُحلّل" : "never"}` },
          { label: lang === "ar" ? "معلّقة" : "Pending", value: `${n("pendingReview")}`, apply: () => onApply("reviewStatus", "pending") },
          { label: lang === "ar" ? "غير مؤكد" : "Uncertain", value: `${n("uncertain")}`, apply: () => onApply("verdict", ["uncertain"]) },
          { label: lang === "ar" ? "متوسط الثقة" : "Avg conf.", value: `${Math.round(n("avgConfidence") * 100)}%`, sub: `${n("belowThreshold")} ${lang === "ar" ? "دون العتبة" : "below"}` },
        ]
      : [
          { label: lang === "ar" ? "في العرض" : "In view", value: `${n("inView")}`, sub: `${lang === "ar" ? "من" : "of"} ${n("total")}` },
          { label: lang === "ar" ? "تحتوي PII" : "Contain PII", value: `${n("pii")}`, sub: `${pct(n("pii"), n("inView"))}%`, apply: () => onApply("piiFlag", true) },
          { label: "CDE", value: `${n("cde")}`, apply: () => onApply("cdeFlag", true) },
          { label: lang === "ar" ? "مصنّفة" : "Classified", value: `${n("classified")}`, sub: `${pct(n("classified"), n("inView"))}%` },
          { label: lang === "ar" ? "تعارضات" : "Conflicts", value: `${n("conflicts")}`, apply: () => onApply("containsConflicts", true) },
          { label: lang === "ar" ? "متوسط الجودة" : "Avg quality", value: `${n("avgQuality")}` },
        ];

  const classDist = kpis.classificationDistribution ?? {};
  const classTotal = Object.values(classDist).reduce((s, v) => s + v, 0);
  const critDist = kpis.criteriaDistribution ?? {};
  const critMax = Math.max(1, ...Object.values(critDist));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
        {cards.map((c) => (
          <Card key={c.label} className={cn(c.apply && "cursor-pointer transition-colors hover:border-primary/50")} onClick={c.apply}>
            <CardContent className="py-3">
              <p className="text-xl font-semibold tabular-nums">{c.value}</p>
              <p className="text-xs text-muted-foreground">{c.label}{c.sub ? ` · ${c.sub}` : ""}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {classTotal > 0 && (
          <Card>
            <CardContent className="py-3">
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">{lang === "ar" ? "توزيع التصنيف" : "Classification distribution"}</p>
              <div className="flex h-3 overflow-hidden rounded-full">
                {Object.entries(classDist).filter(([, v]) => v > 0).map(([level, v]) => (
                  <div key={level} className={cn("h-full", LEVEL_BAR_COLOR[level] ?? "bg-border")} style={{ width: `${(v / classTotal) * 100}%` }} title={`${level}: ${v}`} />
                ))}
              </div>
            </CardContent>
          </Card>
        )}
        {screen === "attributes" && Object.keys(critDist).length > 0 && (
          <Card>
            <CardContent className="py-3">
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">{lang === "ar" ? "توزيع المعايير" : "Criteria distribution"}</p>
              <div className="space-y-1">
                {Object.entries(critDist).map(([code, v]) => (
                  <button key={code} type="button" onClick={() => onApply("criterion", [code])} className="flex w-full items-center gap-2 text-[11px]">
                    <span className="w-28 shrink-0 truncate text-start text-muted-foreground">{code}</span>
                    <span className="h-2 rounded bg-primary" style={{ width: `${(v / critMax) * 100}%`, minWidth: v > 0 ? "4px" : 0 }} />
                    <span className="tabular-nums text-muted-foreground">{v}</span>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

// --- Filter panel ---------------------------------------------------------
function formatFilterValue(v: unknown): string {
  if (Array.isArray(v)) return v.join(", ");
  if (v === true) return "Yes";
  if (v === false) return "No";
  if (v && typeof v === "object") {
    const o = v as { min?: number; max?: number; from?: string; to?: string };
    if ("min" in o || "max" in o) return `${o.min ?? "…"}–${o.max ?? "…"}`;
    if ("from" in o || "to" in o) return `${o.from ?? "…"} → ${o.to ?? "…"}`;
    return JSON.stringify(v);
  }
  return String(v);
}

// --- columns --------------------------------------------------------------
interface CatalogColumn {
  key: string;
  header: string;
  headerAr: string;
  sortable?: boolean;
  /** Hidden until the user opts in via the Columns picker (no saved prefs yet). */
  defaultHidden?: boolean;
  render?: (row: Record<string, unknown>) => React.ReactNode;
}

const dash = <span className="text-muted-foreground">—</span>;

function columnsFor(screen: Screen): CatalogColumn[] {
  if (screen === "assets") {
    return [
      { key: "name", header: "Name", headerAr: "الاسم", sortable: true, render: (r) => <span className="font-medium">{String(r.name)}</span> },
      { key: "ikcAssetId", header: "Asset Id", headerAr: "معرّف الأصل", sortable: true },
      { key: "assetType", header: "Type", headerAr: "النوع", sortable: true },
      { key: "businessDomain", header: "Domain", headerAr: "المجال", render: (r) => (r.businessDomain as string[] | null)?.join(", ") || "—" },
      { key: "assetClassification", header: "Classification", headerAr: "التصنيف", sortable: true, render: (r) => <ClassificationBadge code={r.assetClassification as any} /> },
      { key: "piiFlag", header: "PII", headerAr: "شخصية", render: (r) => (r.piiFlag ? <Badge variant="destructive">PII</Badge> : "—") },
    ];
  }
  // Attribute columns lead with what actually varies row to row — the PII type,
  // the criterion behind the call, and the engine's reasoning. Data type and CDE
  // are constant across most catalogs, so they start hidden.
  return [
    {
      key: "columnName",
      header: "Column",
      headerAr: "العمود",
      sortable: true,
      render: (r) => (
        <div>
          <p className="font-medium">{String(r.columnName)}</p>
          <p className="text-xs text-muted-foreground">{String(r.assetName ?? "")}</p>
        </div>
      ),
    },
    {
      key: "piiType",
      header: "PII type",
      headerAr: "نوع البيانات الشخصية",
      sortable: true,
      // Only worth a column where the catalog carries real data classes — on an
      // IKC import that is mostly "NoClassDetected" it renders as dashes. Opt in
      // from the Columns picker.
      defaultHidden: true,
      render: (r) => {
        const label = displayPiiType({
          verdict: (r.verdict as any) ?? null,
          piiName: r.piiName as string | null,
          dataClassCode: r.dataClassCode as string | null,
          criterion: r.criterion as string | null,
          selectedDataClassName: r.selectedDataClassName as string | null,
        });
        return label ? <span className="text-sm">{label}</span> : dash;
      },
    },
    {
      key: "verdict",
      header: "Verdict",
      headerAr: "الحكم",
      render: (r) =>
        r.verdict ? (
          <div className="flex items-center gap-1.5">
            <VerdictPill verdict={r.verdict as any} />
            {r.conflict ? <TriangleAlert className="h-4 w-4 text-warning" /> : null}
          </div>
        ) : (
          dash
        ),
    },
    {
      key: "criterion",
      header: "Criterion",
      headerAr: "المعيار",
      sortable: true,
      render: (r) => (r.criterion ? <CriterionBadge code={r.criterion as any} /> : dash),
    },
    {
      key: "confidence",
      header: "Confidence",
      headerAr: "الثقة",
      sortable: true,
      render: (r) => {
        if (typeof r.confidence !== "number") return dash;
        const summary = { verdict: r.verdict as any, confidence: r.confidence, conflict: Boolean(r.conflict), nearThreshold: Boolean(r.nearThreshold) };
        return isConfidenceNotable(summary) ? (
          <ConfidenceBar value={r.confidence} />
        ) : (
          <span className="tabular-nums text-xs text-muted-foreground">{Math.round(r.confidence * 100)}%</span>
        );
      },
    },
    {
      key: "rationale",
      header: "Why",
      headerAr: "السبب",
      render: (r) => {
        const text = oneLine((r.rationaleEn as string | null) ?? undefined);
        return text ? (
          <p className="line-clamp-2 max-w-[38ch] text-xs text-muted-foreground" title={text}>{text}</p>
        ) : (
          dash
        );
      },
    },
    {
      key: "reviewStatus",
      header: "Review",
      headerAr: "المراجعة",
      // The Review Queue screen owns this workflow; empty until items are queued.
      defaultHidden: true,
      render: (r) =>
        r.reviewStatus ? <Badge variant={r.reviewStatus === "pending" ? "warning" : "secondary"}>{String(r.reviewStatus)}</Badge> : dash,
    },
    { key: "columnDataClassification", header: "Classification", headerAr: "التصنيف", render: (r) => <ClassificationBadge code={r.columnDataClassification as any} /> },
    { key: "dataType", header: "Type", headerAr: "النوع", sortable: true, defaultHidden: true },
    { key: "assetName", header: "Asset", headerAr: "الأصل", sortable: true, defaultHidden: true },
    { key: "cdeFlag", header: "CDE", headerAr: "حرج", defaultHidden: true, render: (r) => (r.cdeFlag ? <Badge variant="warning">CDE</Badge> : "—") },
  ];
}
