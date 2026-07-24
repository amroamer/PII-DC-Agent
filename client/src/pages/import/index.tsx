import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLanguage } from "@/hooks/useLanguage";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Btn } from "@/components/pdtc/Btn";
import { Alert } from "@/components/pdtc/Alert";

interface ImportResult {
  batchId: number;
  summary: {
    matched: number;
    unmatched: number;
    deletedRows: number;
    piiChanges: number;
    classificationChanges: number;
    clearedFields: number;
    readOnlyWarnings: number;
    columnsAdded: string[];
    columnsRemoved: string[];
  };
}
interface ImportDiff {
  id: number;
  targetId: number;
  field: string;
  currentValue: string | null;
  incomingValue: string | null;
  changeType: string;
  status: string;
}

export default function ImportPage() {
  const { lang } = useLanguage();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [batch, setBatch] = useState<ImportResult | null>(null);
  const [accepted, setAccepted] = useState<Set<number>>(new Set());
  const [justification, setJustification] = useState("");

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/imports", { method: "POST", body: form, credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message ?? "Import failed");
      return (await res.json()) as ImportResult;
    },
    onSuccess: (result) => {
      setBatch(result);
      setAccepted(new Set());
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "Import failed", description: err.message }),
  });

  const diffsQuery = useQuery<ImportDiff[]>({
    queryKey: [`/api/imports/${batch?.batchId}/diffs`],
    enabled: batch !== null,
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      if (!batch) return;
      await apiRequest("POST", `/api/imports/${batch.batchId}/decisions`, { selection: { mode: "include", ids: [...accepted] }, status: "accepted" });
      return apiRequest("POST", `/api/imports/${batch.batchId}/approve`, { justification });
    },
    onSuccess: (res: any) => {
      queryClient.invalidateQueries();
      toast({ title: "Import applied", description: `${res?.applied ?? 0} changes committed.` });
      setBatch(null);
      setJustification("");
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "Approval failed", description: err.message }),
  });

  const diffs = diffsQuery.data ?? [];
  const [changeTypeFilter, setChangeTypeFilter] = useState("");
  const toggle = (id: number) => setAccepted((s) => { const next = new Set(s); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  // Group (filtered) diffs by change type for the review table.
  const groupedDiffs = diffs
    .filter((d) => !changeTypeFilter || d.changeType === changeTypeFilter)
    .reduce<Record<string, ImportDiff[]>>((acc, d) => {
      (acc[d.changeType] ??= []).push(d);
      return acc;
    }, {});

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{lang === "ar" ? "إعادة الاستيراد ومراجعة الفروقات" : "Re-import & Diff Review"}</h1>
        <p className="text-sm text-muted-foreground">
          {lang === "ar" ? "ارفع ملف تصدير سابق. تُطبَّق الأعمدة القابلة للتحرير فقط." : "Upload a previously exported .xlsx. Only editable columns are applied; read-only changes are reported and ignored."}
        </p>
      </header>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Upload className="h-4 w-4" /> {lang === "ar" ? "رفع الملف" : "Upload"}</CardTitle></CardHeader>
        <CardContent>
          <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadMutation.mutate(f); e.target.value = ""; }} />
          <Btn loading={uploadMutation.isPending} onClick={() => fileRef.current?.click()}>{lang === "ar" ? "اختر ملف .xlsx" : "Choose .xlsx"}</Btn>
        </CardContent>
      </Card>

      {batch && (
        <>
          <Alert tone="info" title={lang === "ar" ? "ملخص المطابقة" : "Match summary"}>
            {batch.summary.matched} matched · {batch.summary.unmatched} unmatched · {batch.summary.deletedRows} deleted · {batch.summary.piiChanges} PII changes · {batch.summary.classificationChanges} classification changes · {batch.summary.clearedFields} cleared
            {batch.summary.readOnlyWarnings > 0 && ` · ${batch.summary.readOnlyWarnings} read-only changes ignored`}
            {(batch.summary.columnsAdded?.length || batch.summary.columnsRemoved?.length) ? (
              <span className="mt-1 block text-xs">
                {batch.summary.columnsAdded?.length ? `Added columns: ${batch.summary.columnsAdded.join(", ")}. ` : ""}
                {batch.summary.columnsRemoved?.length ? `Removed columns: ${batch.summary.columnsRemoved.join(", ")}.` : ""}
              </span>
            ) : null}
          </Alert>

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="text-base">{lang === "ar" ? "الفروقات" : "Differences"}</CardTitle>
              <select className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={changeTypeFilter} onChange={(e) => setChangeTypeFilter(e.target.value)}>
                <option value="">{lang === "ar" ? "كل الأنواع" : "All change types"}</option>
                {[...new Set(diffs.map((d) => d.changeType))].map((ct) => <option key={ct} value={ct}>{ct}</option>)}
              </select>
            </CardHeader>
            <CardContent className="space-y-3">
              {Object.entries(groupedDiffs).map(([changeType, group]) => (
                <div key={changeType}>
                  <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{changeType} ({group.length})</p>
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-sm">
                      <thead className="text-muted-foreground"><tr className="border-b"><th className="p-2 text-start">Accept</th><th className="p-2 text-start">Field</th><th className="p-2 text-start">Current</th><th className="p-2 text-start">Incoming</th></tr></thead>
                      <tbody>
                        {group.map((d) => (
                          <tr key={d.id} className="border-b">
                            <td className="p-2"><Checkbox checked={accepted.has(d.id)} onCheckedChange={() => toggle(d.id)} /></td>
                            <td className="p-2">{d.field}</td>
                            <td className="p-2 text-muted-foreground">{d.currentValue}</td>
                            <td className="p-2 font-medium">{d.incomingValue || <span className="italic text-muted-foreground">(cleared)</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
              {diffs.length === 0 && <p className="p-6 text-center text-muted-foreground">{lang === "ar" ? "لا فروقات" : "No differences"}</p>}
              <div className="flex items-center gap-2">
                <button type="button" className="text-sm text-primary underline" onClick={() => setAccepted(new Set(diffs.map((d) => d.id)))}>{lang === "ar" ? "قبول الكل" : "Accept all"}</button>
                <span className="text-xs text-muted-foreground">· {accepted.size} {lang === "ar" ? "مقبول" : "accepted"}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 pt-6">
              <div className="space-y-1.5">
                <Label>{lang === "ar" ? "المبرر (10 أحرف على الأقل)" : "Justification (min 10 chars) *"}</Label>
                <Textarea value={justification} onChange={(e) => setJustification(e.target.value)} rows={2} />
              </div>
              <Btn variant="destructive" loading={approveMutation.isPending} disabled={accepted.size === 0 || justification.trim().length < 10} onClick={() => approveMutation.mutate()}>
                {lang === "ar" ? "اعتماد الاستيراد" : "Approve import"}
              </Btn>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
