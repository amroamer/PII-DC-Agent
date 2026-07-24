import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Bookmark, ChevronDown, Columns3, Download, FileUp, Filter as FilterIcon, Link2, Radar, Save, Search, Tag, Trash2, X } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLanguage } from "@/hooks/useLanguage";
import { useToast } from "@/hooks/use-toast";
import { useCatalogState } from "@/hooks/useCatalogState";
import { useSelection } from "@/hooks/useSelection";
import {
  FILTERS_BY_SCREEN,
  FILTER_GROUP_LABELS,
  type CatalogScreen as Screen,
  type FilterDefinition,
} from "@shared/lib/filter-defs";
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
import { ClassificationBadge } from "./ClassificationBadge";
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
  const { state, effectiveFilters, patchFilter, setFilters, setSearch, setSort, setPage, clearFilters } = useCatalogState(screen);
  const [showFilters, setShowFilters] = useState(false);
  const [wizard, setWizard] = useState<null | "pii" | "classification">(null);
  const [exportOpen, setExportOpen] = useState(false);

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
  const activeChips = defs.filter((d) => d.key !== "search" && effectiveFilters[d.key] !== undefined);
  const columns = useMemo(() => columnsFor(screen), [screen]);
  const totalPages = Math.max(1, Math.ceil(total / state.pageSize));

  // Saved views + per-user column visibility (§2.3).
  const savedViewsQuery = useQuery<Array<{ id: number; name: string; filters: Record<string, unknown>; shared: boolean }>>({
    queryKey: [`/api/saved-views?screen=${screen}`],
  });
  const colPrefsQuery = useQuery<{ columns: string[] | null }>({ queryKey: [`/api/settings/columns?screen=${screen}`] });
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set());
  useEffect(() => {
    const saved = colPrefsQuery.data?.columns;
    if (saved) setHiddenCols(new Set(columns.map((c) => c.key).filter((k) => !saved.includes(k))));
  }, [colPrefsQuery.data, columns]);
  const visibleColumns = columns.filter((c) => !hiddenCols.has(c.key));

  const [viewName, setViewName] = useState("");
  const saveColPrefs = useMutation({ mutationFn: (cols: string[]) => apiRequest("PUT", `/api/settings/columns?screen=${screen}`, { columns: cols }) });
  const toggleCol = (key: string) =>
    setHiddenCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveColPrefs.mutate(columns.map((c) => c.key).filter((k) => !next.has(k)));
      return next;
    });
  const saveViewMutation = useMutation({
    mutationFn: (name: string) => apiRequest("POST", "/api/saved-views", { screen, name, filters: effectiveFilters, columns: visibleColumns.map((c) => c.key), shared: false }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/saved-views?screen=${screen}`] });
      setViewName("");
      toast({ title: "View saved" });
    },
  });
  const deleteViewMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/saved-views/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/saved-views?screen=${screen}`] }),
  });
  const copyLink = () => {
    navigator.clipboard?.writeText(window.location.href).then(() => toast({ title: "Link copied" }));
  };
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
        {/* Saved views */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline"><Bookmark className="h-4 w-4" /> {lang === "ar" ? "العروض" : "Views"}</Button>
          </PopoverTrigger>
          <PopoverContent className="w-72">
            <div className="mb-2 flex gap-1">
              <Input value={viewName} onChange={(e) => setViewName(e.target.value)} placeholder={lang === "ar" ? "اسم العرض" : "View name"} className="h-8" />
              <Button size="sm" disabled={!viewName.trim()} onClick={() => saveViewMutation.mutate(viewName.trim())}><Save className="h-4 w-4" /></Button>
            </div>
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {(savedViewsQuery.data ?? []).map((v) => (
                <div key={v.id} className="flex items-center gap-1">
                  <button type="button" className="flex-1 truncate rounded px-2 py-1 text-start text-sm hover:bg-accent" onClick={() => setFilters(v.filters)}>
                    {v.name}{v.shared ? " ·shared" : ""}
                  </button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => deleteViewMutation.mutate(v.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              ))}
              {(savedViewsQuery.data ?? []).length === 0 && <p className="px-2 py-1 text-xs text-muted-foreground">{lang === "ar" ? "لا عروض محفوظة" : "No saved views"}</p>}
            </div>
          </PopoverContent>
        </Popover>
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
        <Button variant="ghost" size="icon" onClick={copyLink} title={lang === "ar" ? "نسخ الرابط" : "Copy link to this view"}>
          <Link2 className="h-4 w-4" />
        </Button>
        <Button variant="outline" onClick={() => setExportOpen(true)}>
          <Download className="h-4 w-4" /> {lang === "ar" ? "تصدير" : "Export"}
        </Button>
        <Link href="/import">
          <Button variant="outline" asChild>
            <span className="cursor-pointer"><FileUp className="h-4 w-4" /> {lang === "ar" ? "استيراد" : "Import"}</span>
          </Button>
        </Link>
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
            <Button size="sm" variant="ghost" onClick={sel.clear}>{lang === "ar" ? "إلغاء" : "Clear"}</Button>
          </CardContent>
        </Card>
      )}

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
              <TableRow key={row.id} data-state={sel.isSelected(row.id) ? "selected" : undefined}>
                <TableCell>
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
    </div>
  );
}

// --- KPI strip ------------------------------------------------------------
const LEVEL_BAR_COLOR: Record<string, string> = {
  PUBLIC: "bg-success",
  INTERNAL: "bg-muted-foreground/40",
  CONFIDENTIAL: "bg-warning",
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
  if (!kpis) return null;
  const n = (k: string) => Number(kpis[k] ?? 0);
  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

  const cards =
    screen === "attributes"
      ? [
          { label: lang === "ar" ? "في العرض" : "In view", value: `${n("inView")}`, sub: `${lang === "ar" ? "من" : "of"} ${n("total")}` },
          { label: "PII", value: `${n("pii")}`, sub: `${pct(n("pii"), n("analysed"))}%`, apply: () => onApply("verdict", "pii") },
          { label: lang === "ar" ? "فئة خاصة" : "Special", value: `${n("specialCategory")}`, apply: () => onApply("specialCategory", true) },
          { label: lang === "ar" ? "محلّلة" : "Analysed", value: `${n("analysed")}`, sub: `${n("total") - n("analysed")} ${lang === "ar" ? "لم تُحلّل" : "never"}` },
          { label: lang === "ar" ? "معلّقة" : "Pending", value: `${n("pendingReview")}`, apply: () => onApply("reviewStatus", "pending") },
          { label: lang === "ar" ? "غير مؤكد" : "Uncertain", value: `${n("uncertain")}`, apply: () => onApply("verdict", "uncertain") },
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
function FilterPanel({
  screen,
  defs,
  filters,
  onChange,
}: {
  screen: Screen;
  defs: FilterDefinition[];
  filters: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  const { lang } = useLanguage();
  const groups = [...new Set(defs.map((d) => d.group))];
  return (
    <Card>
      <CardContent className="grid gap-4 py-4 md:grid-cols-2 lg:grid-cols-3">
        {groups.map((group) => (
          <div key={group} className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {lang === "ar" ? FILTER_GROUP_LABELS[group].ar : FILTER_GROUP_LABELS[group].en}
            </p>
            {defs.filter((d) => d.group === group && d.key !== "search").map((d) => (
              <FilterField key={d.key} screen={screen} def={d} value={filters[d.key]} onChange={(v) => onChange(d.key, v)} />
            ))}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function FilterField({
  screen,
  def,
  value,
  onChange,
}: {
  screen: Screen;
  def: FilterDefinition;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const { lang } = useLanguage();
  const label = lang === "ar" ? def.labelAr : def.labelEn;

  if (def.control === "text") {
    return <Input value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || undefined)} placeholder={label} className="h-9" />;
  }
  if (def.control === "tristate" || def.control === "boolean" || def.control === "exists") {
    const v = value === true ? "yes" : value === false ? "no" : "any";
    return (
      <div className="flex items-center gap-2">
        <span className="flex-1 text-sm">{label}</span>
        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={v}
          onChange={(e) => onChange(e.target.value === "any" ? undefined : e.target.value === "yes")}
        >
          <option value="any">{lang === "ar" ? "الكل" : "Any"}</option>
          <option value="yes">{lang === "ar" ? "نعم" : "Yes"}</option>
          <option value="no">{lang === "ar" ? "لا" : "No"}</option>
        </select>
      </div>
    );
  }
  if (def.control === "enum") {
    return (
      <div className="flex items-center gap-2">
        <span className="flex-1 text-sm">{label}</span>
        <select
          className="h-9 max-w-[10rem] rounded-md border border-input bg-background px-2 text-sm"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value || undefined)}
        >
          <option value="">{lang === "ar" ? "الكل" : "Any"}</option>
          {def.staticOptions?.map((o) => (
            <option key={o.value} value={o.value}>{lang === "ar" ? o.labelAr : o.labelEn}</option>
          ))}
        </select>
      </div>
    );
  }
  if (def.control === "numeric-range") {
    const v = (value as { min?: number; max?: number }) ?? {};
    const set = (patch: { min?: number; max?: number }) => {
      const next = { ...v, ...patch };
      const cleaned = Object.fromEntries(Object.entries(next).filter(([, x]) => typeof x === "number" && !Number.isNaN(x)));
      onChange(Object.keys(cleaned).length ? cleaned : undefined);
    };
    return (
      <div className="space-y-1">
        <span className="text-sm">{label}</span>
        <div className="flex items-center gap-1">
          <Input type="number" className="h-9" placeholder={lang === "ar" ? "من" : "min"} value={v.min ?? ""} onChange={(e) => set({ min: e.target.value === "" ? undefined : Number(e.target.value) })} />
          <span className="text-muted-foreground">–</span>
          <Input type="number" className="h-9" placeholder={lang === "ar" ? "إلى" : "max"} value={v.max ?? ""} onChange={(e) => set({ max: e.target.value === "" ? undefined : Number(e.target.value) })} />
        </div>
      </div>
    );
  }
  if (def.control === "date-range") {
    const v = (value as { from?: string; to?: string }) ?? {};
    const set = (patch: { from?: string; to?: string }) => {
      const next = { ...v, ...patch };
      const cleaned = Object.fromEntries(Object.entries(next).filter(([, x]) => x));
      onChange(Object.keys(cleaned).length ? cleaned : undefined);
    };
    return (
      <div className="space-y-1">
        <span className="text-sm">{label}</span>
        <div className="flex items-center gap-1">
          <Input type="date" className="h-9" value={v.from ?? ""} onChange={(e) => set({ from: e.target.value || undefined })} />
          <span className="text-muted-foreground">–</span>
          <Input type="date" className="h-9" value={v.to ?? ""} onChange={(e) => set({ to: e.target.value || undefined })} />
        </div>
      </div>
    );
  }
  // multiselect
  return <MultiSelectFilter screen={screen} def={def} value={(value as string[]) ?? []} onChange={onChange} label={label} />;
}

function MultiSelectFilter({
  screen,
  def,
  value,
  onChange,
  label,
}: {
  screen: Screen;
  def: FilterDefinition;
  value: string[];
  onChange: (v: unknown) => void;
  label: string;
}) {
  const { lang } = useLanguage();
  const [open, setOpen] = useState(false);
  const distinctQuery = useQuery<Array<{ value: string; count: number }>>({
    queryKey: [`/api/catalog/filter-options?screen=${screen}&key=${def.key}`],
    enabled: open && def.optionsSource === "distinct",
  });
  const options = def.optionsSource === "static"
    ? (def.staticOptions ?? []).map((o) => ({ value: o.value, label: lang === "ar" ? o.labelAr : o.labelEn }))
    : (distinctQuery.data ?? []).map((o) => ({ value: o.value, label: `${o.value} (${o.count})` }));

  const toggle = (v: string) => {
    const next = value.includes(v) ? value.filter((x) => x !== v) : [...value, v];
    onChange(next.length ? next : undefined);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="w-full justify-between font-normal">
          <span className="truncate">{label}{value.length ? ` (${value.length})` : ""}</span>
          <ChevronDown className="h-3 w-3 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="max-h-60 w-64 overflow-y-auto">
        {options.length === 0 && <p className="py-2 text-center text-sm text-muted-foreground">{lang === "ar" ? "لا خيارات" : "No options"}</p>}
        {options.map((o) => (
          <button key={o.value} type="button" onClick={() => toggle(o.value)} className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-start text-sm hover:bg-accent">
            <Checkbox checked={value.includes(o.value)} />
            <span className="truncate">{o.label}</span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

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
  render?: (row: Record<string, unknown>) => React.ReactNode;
}

function columnsFor(screen: Screen): CatalogColumn[] {
  if (screen === "assets") {
    return [
      { key: "name", header: "Name", headerAr: "الاسم", sortable: true, render: (r) => <span className="font-medium">{String(r.name)}</span> },
      { key: "ikcAssetId", header: "Asset Id", headerAr: "معرّف الأصل", sortable: true },
      { key: "assetType", header: "Type", headerAr: "النوع", sortable: true },
      { key: "businessDomain", header: "Domain", headerAr: "المجال", sortable: true },
      { key: "assetClassification", header: "Classification", headerAr: "التصنيف", sortable: true, render: (r) => <ClassificationBadge code={r.assetClassification as any} /> },
      { key: "piiFlag", header: "PII", headerAr: "شخصية", render: (r) => (r.piiFlag ? <Badge variant="destructive">PII</Badge> : "—") },
    ];
  }
  return [
    { key: "columnName", header: "Column", headerAr: "العمود", sortable: true, render: (r) => <span className="font-medium">{String(r.columnName)}</span> },
    { key: "assetName", header: "Asset", headerAr: "الأصل", sortable: true },
    { key: "dataType", header: "Type", headerAr: "النوع", sortable: true },
    { key: "columnDataClassification", header: "Classification", headerAr: "التصنيف", render: (r) => <ClassificationBadge code={r.columnDataClassification as any} /> },
    { key: "cdeFlag", header: "CDE", headerAr: "حرج", render: (r) => (r.cdeFlag ? <Badge variant="warning">CDE</Badge> : "—") },
  ];
}
