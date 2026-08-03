import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import {
  FILTER_GROUP_LABELS,
  type CatalogScreen as Screen,
  type FilterDefinition,
} from "@shared/lib/filter-defs";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useLanguage } from "@/hooks/useLanguage";
import { cn } from "@/lib/utils";

export function FilterPanel({
  screen,
  defs,
  filters,
  onChange,
  flat,
}: {
  screen: Screen;
  defs: FilterDefinition[];
  filters: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  /** Render a compact grid with no group headers (used for the run-scope picker). */
  flat?: boolean;
}) {
  const { lang } = useLanguage();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const availabilityQuery = useQuery<Record<string, boolean>>({ queryKey: ["/api/catalog/filter-availability"] });

  // A filter tied to an unused feature can only ever return zero rows, so it is
  // not rendered at all until that feature has data. Until the probe resolves,
  // assume unavailable — better a filter that appears a moment late than a panel
  // that flashes controls which then vanish.
  const available = (d: FilterDefinition) => !d.availability || availabilityQuery.data?.[d.availability] === true;
  // An advanced filter the user has already set stays visible, so an active
  // filter can never hide behind a collapsed section.
  const isActive = (d: FilterDefinition) => filters[d.key] !== undefined;

  const visible = defs.filter((d) => d.key !== "search" && available(d));
  const shown = visible.filter((d) => !d.advanced || showAdvanced || isActive(d));
  const hiddenCount = visible.length - shown.length;

  if (flat) {
    return (
      <Card>
        <CardContent className="grid gap-3 py-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((d) => (
            <FilterField key={d.key} screen={screen} def={d} value={filters[d.key]} onChange={(v) => onChange(d.key, v)} />
          ))}
        </CardContent>
      </Card>
    );
  }

  const groups = [...new Set(shown.map((d) => d.group))];
  return (
    <Card>
      <CardContent className="space-y-4 py-4">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {groups.map((group) => (
            <div key={group} className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {lang === "ar" ? FILTER_GROUP_LABELS[group].ar : FILTER_GROUP_LABELS[group].en}
              </p>
              {shown.filter((d) => d.group === group).map((d) => (
                <FilterField key={d.key} screen={screen} def={d} value={filters[d.key]} onChange={(v) => onChange(d.key, v)} />
              ))}
            </div>
          ))}
        </div>
        {(hiddenCount > 0 || showAdvanced) && (
          <Button variant="ghost" size="sm" onClick={() => setShowAdvanced((v) => !v)} className="gap-1">
            <ChevronDown className={cn("h-4 w-4 transition-transform", showAdvanced && "rotate-180")} />
            {showAdvanced
              ? lang === "ar" ? "إخفاء المرشحات المتقدمة" : "Fewer filters"
              : lang === "ar" ? `المزيد من المرشحات (${hiddenCount})` : `More filters (${hiddenCount})`}
          </Button>
        )}
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
  const [search, setSearch] = useState("");
  const distinctQuery = useQuery<Array<{ value: string; count: number }>>({
    queryKey: [`/api/catalog/filter-options?screen=${screen}&key=${def.key}`],
    enabled: open && def.optionsSource === "distinct",
  });
  const allOptions = def.optionsSource === "static"
    ? (def.staticOptions ?? []).map((o) => ({ value: o.value, label: lang === "ar" ? o.labelAr : o.labelEn }))
    : (distinctQuery.data ?? []).map((o) => ({ value: o.value, label: `${o.value} (${o.count})` }));
  const q = search.trim().toLowerCase();
  const options = q
    ? allOptions.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q))
    : allOptions;

  const toggle = (v: string) => {
    const next = value.includes(v) ? value.filter((x) => x !== v) : [...value, v];
    onChange(next.length ? next : undefined);
  };

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSearch(""); }}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="w-full justify-between font-normal">
          <span className="truncate">{label}{value.length ? ` (${value.length})` : ""}</span>
          <ChevronDown className="h-3 w-3 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0">
        <div className="border-b p-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={lang === "ar" ? "بحث…" : "Search…"}
            className="h-8"
            autoFocus
          />
        </div>
        <div className="max-h-60 overflow-y-auto p-1">
          {options.length === 0 && (
            <p className="py-2 text-center text-sm text-muted-foreground">
              {distinctQuery.isLoading ? (lang === "ar" ? "جارٍ التحميل…" : "Loading…") : (lang === "ar" ? "لا خيارات" : "No options")}
            </p>
          )}
          {options.map((o) => (
            <button key={o.value} type="button" onClick={() => toggle(o.value)} className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-start text-sm hover:bg-accent">
              <Checkbox checked={value.includes(o.value)} />
              <span className="truncate">{o.label}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
