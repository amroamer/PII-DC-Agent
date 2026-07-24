import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Bot, FileCog, ScrollText, SlidersHorizontal, ShieldCheck } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLanguage } from "@/hooks/useLanguage";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

function FrameworkEditor({ type }: { type: "pii" | "classification" }) {
  const { toast } = useToast();
  const active = useQuery<{ version: string; definition: Record<string, unknown> }>({ queryKey: [`/api/frameworks/${type}`] });
  const versions = useQuery<FrameworkVersionRow[]>({ queryKey: [`/api/frameworks/${type}/versions`] });
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (active.data) setDraft(JSON.stringify(active.data.definition, null, 2));
  }, [active.data]);

  const saveMutation = useMutation({
    mutationFn: (definition: Record<string, unknown>) => apiRequest("PUT", `/api/frameworks/${type}`, { definition, changeNote: note }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/frameworks/${type}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/frameworks/${type}/versions`] });
      setNote("");
      toast({ title: "New framework version saved" });
    },
  });
  const restoreMutation = useMutation({
    mutationFn: (versionId: number) => apiRequest("POST", `/api/frameworks/${type}/restore/${versionId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/frameworks/${type}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/frameworks/${type}/versions`] });
      toast({ title: "Version restored (as a new version)" });
    },
  });

  const onSave = () => {
    try {
      const parsed = JSON.parse(draft);
      setError(null);
      saveMutation.mutate(parsed);
    } catch {
      setError("Invalid JSON.");
    }
  };

  const versionColumns: Column<FrameworkVersionRow>[] = [
    { key: "version", header: "Version", render: (r) => <Badge variant="secondary">{r.version}</Badge> },
    { key: "changeNote", header: "Note" },
    { key: "createdAt", header: "Created", render: (r) => formatDateTime(r.createdAt) },
    { key: "actions", header: "", render: (r) => <Button size="sm" variant="ghost" onClick={() => restoreMutation.mutate(r.id)}>Restore</Button> },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base"><ScrollText className="h-4 w-4" /> {type === "pii" ? "PII Framework" : "Classification Framework"}</CardTitle>
          <Badge variant="secondary">{active.data?.version}</Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          <Alert tone="warning" title="Every save creates a new immutable version.">
            Approved runs stay pinned to the version they used; staged runs referencing the previous version should be re-run.
          </Alert>
          <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={16} className="font-mono text-xs" />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex items-center gap-2">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Change note" className="max-w-xs" />
            <Btn loading={saveMutation.isPending} onClick={onSave}>Save new version</Btn>
            <a className="text-sm text-primary underline" href={`/api/frameworks/${type}/export`}>Export JSON</a>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Version history</CardTitle></CardHeader>
        <CardContent>
          <DataTable columns={versionColumns} rows={versions.data ?? []} getRowKey={(r) => r.id} loading={versions.isLoading} />
        </CardContent>
      </Card>
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
