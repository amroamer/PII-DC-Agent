import { Fragment, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight, Bot, ChevronDown, ChevronRight, ChevronUp, FileCog, GripVertical, Info, Plus, ScrollText, Search, SlidersHorizontal, ShieldCheck, Trash2 } from "lucide-react";
import { CRITERION_CODES } from "@shared/lib/criteria";
import { CLASSIFICATION_CODES } from "@shared/lib/classification";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLanguage } from "@/hooks/useLanguage";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Btn } from "@/components/pdtc/Btn";
import { Alert } from "@/components/pdtc/Alert";
import { DataTable, type Column } from "@/components/pdtc/DataTable";
import { formatDateTime } from "@/lib/formatDate";
import { cn } from "@/lib/utils";

type Section = "ai" | "pii-framework" | "classification-framework" | "general";

export default function SettingsPage() {
  const { lang } = useLanguage();
  const [section, setSection] = useState<Section>("ai");

  const nav: { key: Section; label: string; icon: React.ReactNode }[] = [
    { key: "ai", label: lang === "ar" ? "مزوّد الذكاء" : "AI Provider", icon: <Bot className="h-4 w-4" /> },
    { key: "pii-framework", label: lang === "ar" ? "إطار البيانات الشخصية" : "PII Framework", icon: <ShieldCheck className="h-4 w-4" /> },
    { key: "classification-framework", label: lang === "ar" ? "إطار التصنيف" : "Classification Framework", icon: <FileCog className="h-4 w-4" /> },
    { key: "general", label: lang === "ar" ? "عام" : "General", icon: <SlidersHorizontal className="h-4 w-4" /> },
  ];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{lang === "ar" ? "الإعدادات" : "Settings"}</h1>
      </header>
      <div className="flex flex-col gap-6 md:flex-row">
        <nav className="w-full shrink-0 space-y-1 md:w-56">
          {nav.map((n) => (
            <button
              key={n.key}
              type="button"
              onClick={() => setSection(n.key)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm",
                section === n.key ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent",
              )}
            >
              {n.icon}
              {n.label}
            </button>
          ))}
        </nav>
        <div className="flex-1">
          {section === "ai" && <AiSettings />}
          {section === "pii-framework" && <FrameworkEditor type="pii" />}
          {section === "classification-framework" && <FrameworkEditor type="classification" />}
          {section === "general" && <GeneralSettings />}
        </div>
      </div>
    </div>
  );
}

// --- AI provider ----------------------------------------------------------
interface AiConfig {
  baseUrl: string;
  model: string;
  apiKeyMasked: string;
  seed: number;
  temperature: number;
  batchSize: number;
  confidenceThreshold: number;
  confidenceFloor: number;
  selfConsistencySamples: number;
  maxBatchSize: number;
}
interface TestResult { ok: boolean; latencyMs: number; configuredModel: string; returnedModel: string | null; error?: string }
interface CacheStats { entries: number; totalHits: number; hitRate: number; sizeBytes: number }

function AiSettings() {
  const { toast } = useToast();
  const cfg = useQuery<AiConfig>({ queryKey: ["/api/settings/ai"] });
  const cache = useQuery<CacheStats>({ queryKey: ["/api/settings/ai/cache"] });
  const [test, setTest] = useState<TestResult | null>(null);
  const [confirmClear, setConfirmClear] = useState("");

  const testMutation = useMutation({
    mutationFn: () => apiRequest<TestResult>("POST", "/api/settings/ai/test-connection"),
    onSuccess: setTest,
  });
  const clearMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", "/api/settings/ai/cache"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/ai/cache"] });
      setConfirmClear("");
      toast({ title: "Cache cleared" });
    },
  });

  const c = cfg.data;
  const [form, setForm] = useState<Record<string, number | string>>({});
  const [apiKey, setApiKey] = useState("");
  useEffect(() => {
    if (c) setForm({ seed: c.seed, maxBatchSize: c.maxBatchSize, batchSize: c.batchSize, confidenceThreshold: c.confidenceThreshold, confidenceFloor: c.confidenceFloor, selfConsistencySamples: c.selfConsistencySamples });
  }, [c]);
  const saveMutation = useMutation({
    mutationFn: () => apiRequest("PUT", "/api/settings/ai", { ...form, ...(apiKey ? { apiKey } : {}) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/ai"] });
      setApiKey("");
      toast({ title: "AI settings saved" });
    },
  });
  const numField = (key: string, label: string, step = "1") => (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input type="number" step={step} value={form[key] ?? ""} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value === "" ? "" : Number(e.target.value) }))} />
    </div>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">AI Provider</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <ReadOnly label="Base URL (env)" value={c?.baseUrl} />
            <ReadOnly label="Model (pinned, env)" value={c?.model} />
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">API key (write-only)</Label>
              <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={c?.apiKeyMasked ?? "sk-…"} />
            </div>
            <ReadOnly label="Temperature" value="0 (locked — determinism requirement)" />
            {numField("seed", "Seed")}
            {numField("maxBatchSize", "Max batch size")}
            {numField("batchSize", "Default batch size")}
            {numField("confidenceThreshold", "Confidence threshold", "0.05")}
            {numField("confidenceFloor", "Confidence floor", "0.05")}
            {numField("selfConsistencySamples", "Self-consistency samples")}
          </div>
          <Btn loading={saveMutation.isPending} onClick={() => saveMutation.mutate()}>Save AI settings</Btn>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Test connection</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Btn loading={testMutation.isPending} onClick={() => testMutation.mutate()}>Test connection</Btn>
          {test && (
            <Alert tone={test.ok ? "success" : "error"} title={test.ok ? `OK · ${test.latencyMs}ms` : `Failed · ${test.error}`}>
              Configured: {test.configuredModel} · Endpoint returned: {test.returnedModel ?? "—"}
              {test.returnedModel && test.returnedModel !== test.configuredModel && " ⚠ model substitution detected"}
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Inference cache</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {cache.data?.entries ?? 0} entries · {cache.data?.totalHits ?? 0} hits · hit rate {Math.round((cache.data?.hitRate ?? 0) * 100)}% · {Math.round((cache.data?.sizeBytes ?? 0) / 1024)} KB
          </p>
          <div className="flex items-center gap-2">
            <Input value={confirmClear} onChange={(e) => setConfirmClear(e.target.value)} placeholder='Type "CLEAR" to confirm' className="max-w-xs" />
            <Btn variant="destructive" disabled={confirmClear !== "CLEAR"} loading={clearMutation.isPending} onClick={() => clearMutation.mutate()}>Clear cache</Btn>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// --- Framework editor (generic) ------------------------------------------
interface FrameworkVersionRow { id: number; version: string; changeNote: string | null; createdAt: string }

type Definition = Record<string, any>;

function FrameworkEditor({ type }: { type: "pii" | "classification" }) {
  const { toast } = useToast();
  const active = useQuery<{ version: string; definition: Definition }>({ queryKey: [`/api/frameworks/${type}`] });
  const versions = useQuery<FrameworkVersionRow[]>({ queryKey: [`/api/frameworks/${type}/versions`] });
  const [def, setDef] = useState<Definition | null>(null);
  const [mode, setMode] = useState<"structured" | "json">("structured");
  const [jsonDraft, setJsonDraft] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const historyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (active.data) { setDef(active.data.definition); setError(null); }
  }, [active.data]);

  const saveMutation = useMutation({
    mutationFn: (definition: Definition) => apiRequest("PUT", `/api/frameworks/${type}`, { definition, changeNote: note }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/frameworks/${type}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/frameworks/${type}/versions`] });
      setNote("");
      toast({ title: "New framework version saved" });
    },
    onError: (e: Error) => setError(e.message),
  });
  const restoreMutation = useMutation({
    mutationFn: (versionId: number) => apiRequest("POST", `/api/frameworks/${type}/restore/${versionId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/frameworks/${type}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/frameworks/${type}/versions`] });
      toast({ title: "Version restored (as a new version)" });
    },
  });

  const enterJson = () => { setJsonDraft(JSON.stringify(def, null, 2)); setError(null); setMode("json"); };
  const enterStructured = () => {
    try { setDef(JSON.parse(jsonDraft)); setError(null); setMode("structured"); }
    catch { setError("Invalid JSON — fix it before switching to the form."); }
  };

  const onSave = () => {
    let payload = def;
    if (mode === "json") {
      try { payload = JSON.parse(jsonDraft); setDef(payload); }
      catch { setError("Invalid JSON."); return; }
    }
    if (!payload) return;
    setError(null);
    saveMutation.mutate(payload);
  };

  const versionColumns: Column<FrameworkVersionRow>[] = [
    { key: "version", header: "Version", render: (r) => <Badge variant="secondary">{r.version}</Badge> },
    { key: "changeNote", header: "Note" },
    { key: "createdAt", header: "Created", render: (r) => formatDateTime(r.createdAt) },
    { key: "actions", header: "", render: (r) => <Button size="sm" variant="ghost" onClick={() => restoreMutation.mutate(r.id)}>Restore</Button> },
  ];

  return (
    <TooltipProvider>
      <div className="space-y-4">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base"><ScrollText className="h-4 w-4" /> {type === "pii" ? "PII Framework" : "Classification Framework"}</CardTitle>
            <button type="button" onClick={() => historyRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })} title="Jump to version history">
              <Badge variant="secondary" className="cursor-pointer gap-1 hover:bg-secondary/70">{active.data?.version} · {(versions.data ?? []).length} versions</Badge>
            </button>
          </CardHeader>
          <CardContent className="space-y-3">
            <Alert tone="warning" title="Every save creates a new immutable version.">
              Approved runs stay pinned to the version they used; staged runs referencing the previous version should be re-run. <InfoTip text={GLOSSARY.immutable} />
            </Alert>
            <div className="flex justify-end">
              <button type="button" className="text-xs text-primary underline" onClick={mode === "structured" ? enterJson : enterStructured}>
                {mode === "structured" ? "Advanced (raw JSON)" : "Back to form"}
              </button>
            </div>
            {mode === "structured" && def ? (
              type === "pii"
                ? <PiiEditor def={def} onChange={setDef} />
                : <ClassificationEditor def={def} onChange={setDef} />
            ) : (
              <Textarea value={jsonDraft} onChange={(e) => setJsonDraft(e.target.value)} rows={18} className="font-mono text-xs" />
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            {/* Sticky save bar — always reachable while scrolling a long framework. */}
            <div className="sticky bottom-0 -mx-6 -mb-6 flex items-center gap-2 border-t bg-background/95 px-6 py-3 backdrop-blur">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Change note" className="max-w-xs" />
              <Btn loading={saveMutation.isPending} onClick={onSave}>Save new version</Btn>
              <a className="text-sm text-primary underline" href={`/api/frameworks/${type}/export`}>Export JSON</a>
            </div>
          </CardContent>
        </Card>

        <div ref={historyRef}>
          <Card>
            <CardHeader><CardTitle className="text-base">Version history</CardTitle></CardHeader>
            <CardContent>
              <DataTable columns={versionColumns} rows={versions.data ?? []} getRowKey={(r) => r.id} loading={versions.isLoading} />
            </CardContent>
          </Card>
        </div>
      </div>
    </TooltipProvider>
  );
}

function Sel({ value, onChange, options, className }: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <select
      className={cn("h-9 w-full rounded-md border border-input bg-background px-2 text-sm", className)}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/** One expandable row: a summary header (with optional right-aligned actions) that
 *  opens a roomy editor body in place. */
function AccordionRow({ open, onToggle, summary, actions, children }: {
  open: boolean;
  onToggle: () => void;
  summary: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border">
      <div className="flex items-center gap-1 pe-2">
        <button type="button" onClick={onToggle} className="flex flex-1 items-center gap-2 rounded-md p-3 text-start hover:bg-accent/50">
          <ChevronRight className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
          <div className="min-w-0 flex-1">{summary}</div>
        </button>
        {actions && <div className="flex shrink-0 items-center gap-0.5">{actions}</div>}
      </div>
      {open && <div className="border-t p-4">{children}</div>}
    </div>
  );
}

/** Explains how the current framework feeds the pipeline (PII → classification → roll-up). */
function FlowHint({ type }: { type: "pii" | "classification" }) {
  return (
    <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-xs leading-relaxed text-muted-foreground">
      {type === "pii" ? (
        <p>
          <span className="font-medium text-foreground">How this is used: </span>
          each criterion is a test the engine applies to decide whether a column is personal data and which reason applies.
          A criterion&apos;s <span className="font-medium">description is sent to the AI as guidance</span>. The result — a
          verdict + criterion — then flows into the <span className="font-medium">Classification rules</span>.
        </p>
      ) : (
        <p>
          <span className="font-medium text-foreground">How this is used: </span>
          rules read the PII engine&apos;s output for each column — <span className="font-mono">verdict</span>,{" "}
          <span className="font-mono">criterion</span>, and the special-category flag — and turn it into a level
          (top-down, first match wins). A table then inherits its <span className="font-medium">most sensitive</span>{" "}
          column&apos;s level (roll-up).
        </p>
      )}
    </div>
  );
}

/** Human-readable "When …" clause for a classification rule's match conditions. */
function ruleSentence(r: any): string {
  const conds: string[] = [];
  if (r.isSpecialCategory === true) conds.push("data is special-category");
  else if (r.isSpecialCategory === false) conds.push("data is not special-category");
  if (r.criterion) conds.push(`criterion is ${r.criterion}`);
  if (r.verdict) conds.push(`verdict is ${r.verdict}`);
  return `When ${conds.length ? conds.join(" and ") : "any data"}`;
}

/** Canonical example columns per criterion, shown inline so editors grasp scope at a glance. */
const CRITERION_EXAMPLES: Record<string, string[]> = {
  DIRECT_ID: ["FULL_NAME", "EMIRATES_ID", "PASSPORT_NO"],
  INDIRECT_ID: ["DATE_OF_BIRTH", "MOBILE_NO", "EMAIL", "PLATE_NO"],
  REGULATORY: ["TAX_ID", "TRADE_LICENSE_NO"],
  CONTEXTUAL: ["REMARKS", "NOTES", "FREE_TEXT"],
  SPECIAL_CATEGORY: ["RELIGION", "HEALTH_STATUS", "PHOTO", "FINGERPRINT"],
};

/** colorToken → Tailwind classes (mirrors ClassificationBadge) for level chips/swatches. */
const LEVEL_TOKEN_CLASS: Record<string, string> = {
  success: "bg-success/15 text-success border-success/30",
  muted: "bg-muted text-muted-foreground border-border",
  info: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30",
  warning: "bg-warning/15 text-warning border-warning/30",
  destructive: "bg-destructive/15 text-destructive border-destructive/30",
};

/** Plain-language glossary for the jargon tooltips. */
const GLOSSARY: Record<string, string> = {
  intrinsic: "Decidable from the column's own metadata (name/description) — the deterministic layers can resolve it without the AI.",
  contextual: "Needs semantic judgement or surrounding context — the AI layer weighs in.",
  firstMatch: "Rules are checked top to bottom; the FIRST rule whose conditions all match sets the level. Order matters — drag to change it.",
  rollup: "A table's level = its most sensitive column's level (high-water-mark).",
  immutable: "Saving never edits the current version — it creates a new one. Past approved runs stay pinned to the version they used.",
  special: "Special categories (health, biometric, religion, ethnicity) that warrant stricter handling.",
};

/** Info (i) tooltip trigger. The screen is wrapped in <TooltipProvider>. */
function InfoTip({ text }: { text: string }) {
  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <button type="button" tabIndex={-1} className="inline-flex align-middle text-muted-foreground hover:text-foreground"><Info className="h-3.5 w-3.5" /></button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-start leading-relaxed">{text}</TooltipContent>
    </Tooltip>
  );
}

/** Visual pipeline: how a column flows through both frameworks; the current stage is highlighted. */
function Pipeline({ type }: { type: "pii" | "classification" }) {
  const { lang } = useLanguage();
  const stages: { label: string; on: "pii" | "classification" | null }[] = [
    { label: lang === "ar" ? "بيانات العمود" : "Column metadata", on: null },
    { label: lang === "ar" ? "معايير PII" : "PII criteria", on: "pii" },
    { label: lang === "ar" ? "الحكم + السبب" : "Verdict + reason", on: null },
    { label: lang === "ar" ? "قواعد التصنيف" : "Classification rules", on: "classification" },
    { label: lang === "ar" ? "المستوى" : "Level", on: null },
    { label: lang === "ar" ? "تجميع الجدول" : "Table roll-up", on: "classification" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border bg-muted/20 p-3">
      {stages.map((s, i) => (
        <Fragment key={s.label}>
          <span className={cn("rounded px-2 py-1 text-xs", s.on === type ? "bg-primary font-medium text-primary-foreground" : "border bg-background text-muted-foreground")}>{s.label}</span>
          {i < stages.length - 1 && <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
        </Fragment>
      ))}
    </div>
  );
}

/** A classification level rendered with its configured colour (or a red "gap" when no rule matches). */
function LevelChip({ levels, code }: { levels: any[]; code: string | null }) {
  if (!code) return <span className="text-[11px] font-medium text-destructive">— gap</span>;
  const lvl = levels.find((l) => l.code === code);
  return (
    <span className={cn("inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium", LEVEL_TOKEN_CLASS[lvl?.colorToken ?? "muted"] ?? LEVEL_TOKEN_CLASS.muted)}>
      {lvl?.labelEn ?? code}
    </span>
  );
}

/** Evaluate the rule list (top-down, first match wins) for one input. */
function classifyByRules(rules: any[], ctx: { verdict: string; criterion: string | null; special: boolean }): string | null {
  for (const r of rules) {
    if (r.isSpecialCategory !== undefined && r.isSpecialCategory !== ctx.special) continue;
    if (r.criterion && r.criterion !== ctx.criterion) continue;
    if (r.verdict && r.verdict !== ctx.verdict) continue;
    return r.level ?? null;
  }
  return null;
}

/** Truth-table: every criterion × verdict → the level the current rules produce. Reveals gaps at a glance. */
function TruthTable({ rules, levels }: { rules: any[]; levels: any[] }) {
  const verdicts = ["pii", "uncertain", "not_pii"];
  const rows: { label: string; criterion: string | null; special: boolean }[] = [
    ...CRITERION_CODES.map((c) => ({ label: c as string, criterion: c as string, special: c === "SPECIAL_CATEGORY" })),
    { label: "(no criterion)", criterion: null, special: false },
  ];
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-xs">
        <thead className="bg-muted/40 text-muted-foreground">
          <tr>
            <th className="p-2 text-start font-medium">Criterion \ Verdict</th>
            {verdicts.map((v) => <th key={v} className="p-2 text-start font-medium">{v}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-t">
              <td className="whitespace-nowrap p-2 font-mono">{row.label}{row.special ? " *" : ""}</td>
              {verdicts.map((v) => (
                <td key={v} className="p-2"><LevelChip levels={levels} code={classifyByRules(rules, { verdict: v, criterion: row.criterion, special: row.special })} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PiiEditor({ def, onChange }: { def: Definition; onChange: (d: Definition) => void }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const criteria: any[] = Array.isArray(def.criteria) ? def.criteria : [];
  const patchCrit = (i: number, patch: Record<string, unknown>) =>
    onChange({ ...def, criteria: criteria.map((c, idx) => (idx === i ? { ...c, ...patch } : c)) });
  const keyOf = (c: any, i: number) => c.code ?? String(i);
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const q = search.trim().toLowerCase();
  const shown = criteria.map((c, i) => ({ c, i })).filter(({ c }) => !q || `${c.code} ${c.nameEn} ${c.nameAr} ${c.description}`.toLowerCase().includes(q));

  return (
    <div className="space-y-4">
      <Pipeline type="pii" />
      <FlowHint type="pii" />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute start-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search criteria…" className="h-8 w-52 ps-7 text-xs" />
        </div>
        <button type="button" className="text-xs text-muted-foreground underline hover:text-foreground" onClick={() => setOpen(new Set(criteria.map(keyOf)))}>Expand all</button>
        <button type="button" className="text-xs text-muted-foreground underline hover:text-foreground" onClick={() => setOpen(new Set())}>Collapse all</button>
        <span className="ms-auto text-xs text-muted-foreground">{shown.length}/{criteria.length}</span>
      </div>

      <div className="space-y-2">
        {shown.map(({ c, i }) => {
          const key = keyOf(c, i);
          const examples = CRITERION_EXAMPLES[c.code] ?? [];
          return (
            <AccordionRow
              key={key}
              open={open.has(key)}
              onToggle={() => toggle(key)}
              summary={
                <div className="space-y-1">
                  <div className="flex items-center gap-3">
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{c.code}</span>
                    <span className="truncate font-medium">{c.nameEn}</span>
                    <span className="ms-auto inline-flex shrink-0 items-center gap-1">
                      <Badge variant="outline" className="font-normal">{c.evaluationMode ?? "contextual"}</Badge>
                      <InfoTip text={c.evaluationMode === "intrinsic" ? GLOSSARY.intrinsic : GLOSSARY.contextual} />
                    </span>
                  </div>
                  {/* Inline preview — the AI guidance + example columns, visible without expanding. */}
                  {c.description && <p className="line-clamp-2 pe-6 text-xs font-normal text-muted-foreground">{c.description}</p>}
                  {examples.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">e.g.</span>
                      {examples.map((ex) => <span key={ex} className="rounded bg-accent px-1 py-0.5 font-mono text-[10px] text-muted-foreground">{ex}</span>)}
                    </div>
                  )}
                </div>
              }
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Name (EN)</Label>
                  <Input value={c.nameEn ?? ""} onChange={(e) => patchCrit(i, { nameEn: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Name (AR)</Label>
                  <Input dir="rtl" value={c.nameAr ?? ""} onChange={(e) => patchCrit(i, { nameAr: e.target.value })} />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs text-muted-foreground">Description <span className="font-normal">(sent to the AI as guidance)</span></Label>
                  <Textarea className="min-h-[140px] resize-y" value={c.description ?? ""} onChange={(e) => patchCrit(i, { description: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className="flex items-center gap-1 text-xs text-muted-foreground">Evaluation mode <InfoTip text={`intrinsic — ${GLOSSARY.intrinsic}  ·  contextual — ${GLOSSARY.contextual}`} /></Label>
                  <Sel className="w-48" value={c.evaluationMode ?? "contextual"} onChange={(v) => patchCrit(i, { evaluationMode: v })}
                    options={[{ value: "intrinsic", label: "intrinsic" }, { value: "contextual", label: "contextual" }]} />
                </div>
              </div>
            </AccordionRow>
          );
        })}
      </div>
    </div>
  );
}

function ClassificationEditor({ def, onChange }: { def: Definition; onChange: (d: Definition) => void }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const levels: any[] = Array.isArray(def.levels) ? def.levels : [];
  const rules: any[] = Array.isArray(def.rules) ? def.rules : [];
  const ANY = "";
  const critOptions = [{ value: ANY, label: "any criterion" }, ...CRITERION_CODES.map((c) => ({ value: c, label: c }))];
  const verdictOptions = [{ value: ANY, label: "any verdict" }, ...["pii", "not_pii", "uncertain"].map((v) => ({ value: v, label: v }))];
  const specialOptions = [{ value: ANY, label: "any data" }, { value: "true", label: "special-category" }, { value: "false", label: "not special-category" }];
  const levelOptions = CLASSIFICATION_CODES.map((c) => ({ value: c, label: c }));
  const colorOptions = ["success", "info", "warning", "destructive", "muted"].map((t) => ({ value: t, label: t }));

  const patchLevel = (i: number, patch: Record<string, unknown>) =>
    onChange({ ...def, levels: levels.map((l, idx) => (idx === i ? { ...l, ...patch } : l)) });
  const setRules = (next: any[]) => onChange({ ...def, rules: next });
  const patchRule = (i: number, patch: Record<string, unknown>) =>
    setRules(rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const move = (i: number, dir: number) => {
    const j = i + dir;
    if (j < 0 || j >= rules.length) return;
    const next = rules.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setRules(next);
  };
  const reorder = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0) return;
    const next = rules.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setRules(next);
  };
  const setOpt = (i: number, key: string, v: string) => {
    const r = { ...rules[i] };
    if (v === ANY) delete r[key];
    else r[key] = key === "isSpecialCategory" ? v === "true" : v;
    setRules(rules.map((x, idx) => (idx === i ? r : x)));
  };
  const keyOf = (r: any, i: number) => r.id ?? String(i);
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const q = search.trim().toLowerCase();
  const shownRules = rules.map((r, i) => ({ r, i })).filter(({ r }) => !q || `${ruleSentence(r)} ${r.level} ${r.note}`.toLowerCase().includes(q));
  const canDrag = !q; // dragging only makes sense over the full ordered list

  return (
    <div className="space-y-5">
      <Pipeline type="classification" />
      <FlowHint type="classification" />

      <div>
        <p className="mb-2 text-sm font-medium">Confidentiality levels <span className="font-normal text-muted-foreground">(least → most sensitive)</span></p>
        {/* Colour ladder — the levels at a glance, in rank order. */}
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {[...levels].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0)).map((l, i, arr) => (
            <Fragment key={l.code ?? i}>
              <span className={cn("rounded-md border px-2 py-1 text-xs font-medium", LEVEL_TOKEN_CLASS[l.colorToken ?? "muted"] ?? LEVEL_TOKEN_CLASS.muted)}>{l.labelEn ?? l.code}</span>
              {i < arr.length - 1 && <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
            </Fragment>
          ))}
        </div>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="p-3 text-start">Rank</th>
                <th className="p-3 text-start">Code</th>
                <th className="p-3 text-start">Label (EN)</th>
                <th className="p-3 text-start">Label (AR)</th>
                <th className="p-3 text-start">Color</th>
              </tr>
            </thead>
            <tbody>
              {levels.map((l, i) => (
                <tr key={l.code ?? i} className="border-t">
                  <td className="p-3 text-xs text-muted-foreground">{l.rank}</td>
                  <td className="p-3 font-mono text-xs">{l.code}</td>
                  <td className="p-3"><Input value={l.labelEn ?? ""} onChange={(e) => patchLevel(i, { labelEn: e.target.value })} /></td>
                  <td className="p-3"><Input dir="rtl" value={l.labelAr ?? ""} onChange={(e) => patchLevel(i, { labelAr: e.target.value })} /></td>
                  <td className="w-52 p-3">
                    <div className="flex items-center gap-2">
                      <span className={cn("h-5 w-5 shrink-0 rounded border", LEVEL_TOKEN_CLASS[l.colorToken ?? "muted"] ?? LEVEL_TOKEN_CLASS.muted)} />
                      <Sel value={l.colorToken ?? "muted"} onChange={(v) => patchLevel(i, { colorToken: v })} options={colorOptions} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <p className="flex items-center gap-1 text-sm font-medium">Rules <span className="font-normal text-muted-foreground">(top-down, first match wins)</span><InfoTip text={GLOSSARY.firstMatch} /></p>
          <div className="relative ms-auto">
            <Search className="pointer-events-none absolute start-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search rules…" className="h-8 w-44 ps-7 text-xs" />
          </div>
          <button type="button" className="text-xs text-muted-foreground underline hover:text-foreground" onClick={() => setOpen(new Set(rules.map(keyOf)))}>Expand all</button>
          <button type="button" className="text-xs text-muted-foreground underline hover:text-foreground" onClick={() => setOpen(new Set())}>Collapse all</button>
        </div>
        {canDrag && rules.length > 1 && <p className="mb-2 text-xs text-muted-foreground">Drag <GripVertical className="inline h-3 w-3" /> to reorder — order is the logic (first match wins).</p>}
        <div className="space-y-2">
          {shownRules.map(({ r, i }) => {
            const key = keyOf(r, i);
            return (
              <div
                key={key}
                draggable={canDrag}
                onDragStart={() => canDrag && setDragIdx(i)}
                onDragOver={(e) => { if (canDrag && dragIdx !== null) e.preventDefault(); }}
                onDrop={(e) => { if (canDrag && dragIdx !== null) { e.preventDefault(); reorder(dragIdx, i); setDragIdx(null); } }}
                className={cn(dragIdx === i && "opacity-50")}
              >
                <AccordionRow
                  open={open.has(key)}
                  onToggle={() => toggle(key)}
                  summary={
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      {canDrag && <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground" />}
                      <span className="text-xs text-muted-foreground">{i + 1}.</span>
                      <span>{ruleSentence(r)}</span>
                      <span className="text-muted-foreground">→</span>
                      <LevelChip levels={levels} code={r.level} />
                    </div>
                  }
                  actions={
                    <>
                      <button type="button" className="p-1 text-muted-foreground disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)}><ChevronUp className="h-4 w-4" /></button>
                      <button type="button" className="p-1 text-muted-foreground disabled:opacity-30" disabled={i === rules.length - 1} onClick={() => move(i, 1)}><ChevronDown className="h-4 w-4" /></button>
                      <Button size="icon" variant="ghost" onClick={() => setRules(rules.filter((_, idx) => idx !== i))}><Trash2 className="h-4 w-4" /></Button>
                    </>
                  }
                >
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-end gap-3">
                      <span className="pb-2 text-sm text-muted-foreground">When</span>
                      <div className="space-y-1">
                        <Label className="flex items-center gap-1 text-xs text-muted-foreground">Data <InfoTip text={GLOSSARY.special} /></Label>
                        <Sel className="w-52" value={r.isSpecialCategory === undefined ? ANY : String(r.isSpecialCategory)} onChange={(v) => setOpt(i, "isSpecialCategory", v)} options={specialOptions} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Criterion</Label>
                        <Sel className="w-44" value={r.criterion ?? ANY} onChange={(v) => setOpt(i, "criterion", v)} options={critOptions} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Verdict</Label>
                        <Sel className="w-40" value={r.verdict ?? ANY} onChange={(v) => setOpt(i, "verdict", v)} options={verdictOptions} />
                      </div>
                      <span className="pb-2 text-sm text-muted-foreground">→ classify as</span>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Level</Label>
                        <Sel className="w-40" value={r.level ?? "CONFIDENTIAL"} onChange={(v) => patchRule(i, { level: v })} options={levelOptions} />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Note <span className="font-normal">(shown as the rationale on classified columns)</span></Label>
                      <Input value={r.note ?? ""} onChange={(e) => patchRule(i, { note: e.target.value })} />
                    </div>
                  </div>
                </AccordionRow>
              </div>
            );
          })}
        </div>
        <Button className="mt-2" size="sm" variant="outline" onClick={() => setRules([...rules, { id: `rule-${rules.length + 1}`, verdict: "pii", level: "CONFIDENTIAL", note: "" }])}>
          <Plus className="mr-1 h-4 w-4" /> Add rule
        </Button>
      </div>

      {/* Outcome preview — what the current rules actually produce, gaps included. */}
      <div>
        <p className="mb-2 flex items-center gap-1 text-sm font-medium">Outcome preview <span className="font-normal text-muted-foreground">(what these rules produce · * = special-category)</span><InfoTip text="Every criterion × verdict combination and the level your current rules assign it. A red 'gap' means no rule matches — that column would be left unclassified." /></p>
        <TruthTable rules={rules} levels={levels} />
      </div>

      <div className="space-y-1">
        <Label className="flex items-center gap-1 text-sm font-medium">Roll-up precedence <InfoTip text={GLOSSARY.rollup} /></Label>
        <Input value={def.rollup ?? ""} onChange={(e) => onChange({ ...def, rollup: e.target.value })} />
      </div>
    </div>
  );
}

// --- General (prompts, data classes, thresholds) -------------------------
interface Prompt { key: string; label: string; content: string }
interface DataClass { code: string; nameEn: string; nameAr: string; category: string; isPii: boolean; isSpecialCategory: boolean; source: "ikc" | "adc"; active: boolean }

function GeneralSettings() {
  const { lang } = useLanguage();
  const { toast } = useToast();
  const prompts = useQuery<Prompt[]>({ queryKey: ["/api/settings/prompts"] });
  const classes = useQuery<DataClass[]>({ queryKey: ["/api/settings/data-classes"] });

  const columns: Column<DataClass>[] = [
    { key: "code", header: "Code", render: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { key: "name", header: "Name", render: (r) => (lang === "ar" ? r.nameAr : r.nameEn) },
    { key: "source", header: "Source", render: (r) => <Badge variant="secondary">{r.source}</Badge> },
    { key: "flags", header: "Flags", render: (r) => <div className="flex gap-1">{r.isPii && <Badge variant="destructive">PII</Badge>}{r.isSpecialCategory && <Badge variant="warning">Special</Badge>}</div> },
  ];

  return (
    <div className="space-y-4">
      <GeneralOptions />
      {(prompts.data ?? []).map((p) => <PromptEditor key={p.key} prompt={p} onSaved={() => { queryClient.invalidateQueries({ queryKey: ["/api/settings/prompts"] }); toast({ title: "Prompt saved" }); }} />)}
      <Card>
        <CardHeader><CardTitle className="text-base">Data class library</CardTitle></CardHeader>
        <CardContent><DataTable columns={columns} rows={classes.data ?? []} getRowKey={(r) => r.code} loading={classes.isLoading} /></CardContent>
      </Card>
    </div>
  );
}

interface Thresholds { confidenceReviewThreshold: number; cooccurrenceMinQuasiIdentifiers: number; engineVersion: string }

function GeneralOptions() {
  const { lang, setLang } = useLanguage();
  const { toast } = useToast();
  const thresholds = useQuery<Thresholds>({ queryKey: ["/api/settings/thresholds"] });
  const [reviewThreshold, setReviewThreshold] = useState("");
  const [retentionDays, setRetentionDays] = useState("90");
  useEffect(() => {
    if (thresholds.data) setReviewThreshold(String(thresholds.data.confidenceReviewThreshold));
  }, [thresholds.data]);
  const setSetting = useMutation({
    mutationFn: (vars: { key: string; value: unknown }) => apiRequest("PUT", `/api/settings/${vars.key}`, { value: vars.value }),
    onSuccess: () => toast({ title: "Setting saved" }),
  });

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">General</CardTitle></CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Default language</Label>
          <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={lang} onChange={(e) => setLang(e.target.value as "en" | "ar")}>
            <option value="en">English</option>
            <option value="ar">العربية</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Review threshold</Label>
          <div className="flex gap-1">
            <Input type="number" step="0.05" value={reviewThreshold} onChange={(e) => setReviewThreshold(e.target.value)} />
            <Btn onClick={() => setSetting.mutate({ key: "confidence_review_threshold", value: Number(reviewThreshold) })}>Save</Btn>
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Engine-runs retention (days)</Label>
          <div className="flex gap-1">
            <Input type="number" value={retentionDays} onChange={(e) => setRetentionDays(e.target.value)} />
            <Btn onClick={() => setSetting.mutate({ key: "engine_runs_retention_days", value: Number(retentionDays) })}>Save</Btn>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PromptEditor({ prompt, onSaved }: { prompt: Prompt; onSaved: () => void }) {
  const [content, setContent] = useState(prompt.content);
  useEffect(() => setContent(prompt.content), [prompt.content]);
  const mutation = useMutation({ mutationFn: () => apiRequest("PUT", `/api/settings/prompts/${prompt.key}`, { content }), onSuccess: onSaved });
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base">{prompt.label}<Badge variant="secondary">{prompt.key}</Badge></CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={6} className="font-mono text-xs" />
        <Btn loading={mutation.isPending} disabled={content === prompt.content} onClick={() => mutation.mutate()}>Save prompt</Btn>
      </CardContent>
    </Card>
  );
}

function ReadOnly({ label, value }: { label: string; value?: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">{value || "—"}</p>
    </div>
  );
}
