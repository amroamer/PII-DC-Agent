import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ArrowRight, FileSpreadsheet, Info, Upload } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLanguage } from "@/hooks/useLanguage";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Btn } from "@/components/pdtc/Btn";
import { Alert } from "@/components/pdtc/Alert";

interface FieldChange {
  field: string;
  label: string;
  from: string;
  to: string;
}
interface PreviewItem {
  kind: "asset" | "attribute";
  name: string;
  changes: FieldChange[];
  moreChanges: number;
}
interface DiffCounts {
  new: number;
  changed: number;
  unchanged: number;
}
interface IngestPreview {
  uploadId: string;
  filename: string;
  sheetNames: string[];
  assets: DiffCounts;
  attributes: DiffCounts;
  skipped: number;
  warnings: string[];
  hasChanges: boolean;
  changedItems: PreviewItem[];
  changedItemsTruncated: number;
  newAssetSample: string[];
  newAttributeSample: string[];
}
interface ApplySummary {
  runId: number;
  assetsCreated: number;
  assetsUpdated: number;
  attributesCreated: number;
  attributesUpdated: number;
  unchanged: number;
  skipped: number;
}

const n = (v: number) => v.toLocaleString();

export function AssetImport() {
  const { lang } = useLanguage();
  const ar = lang === "ar";
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<IngestPreview | null>(null);

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/ingest/upload", { method: "POST", body: form, credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message ?? "Upload failed");
      return (await res.json()) as IngestPreview;
    },
    onSuccess: (data) => setPreview(data),
    onError: (err: Error) => toast({ variant: "destructive", title: ar ? "فشل الرفع" : "Upload failed", description: err.message }),
  });

  const applyMutation = useMutation({
    mutationFn: (uploadId: string) => apiRequest<ApplySummary>("POST", "/api/ingest/apply", { uploadId }),
    onSuccess: (s) => {
      queryClient.invalidateQueries();
      setPreview(null);
      toast({
        title: ar ? "تم تطبيق الاستيراد" : "Import applied",
        description: ar
          ? `أصول: ${n(s.assetsCreated)} جديدة، ${n(s.assetsUpdated)} محدّثة · أعمدة: ${n(s.attributesCreated)} جديدة، ${n(s.attributesUpdated)} محدّثة`
          : `Assets: ${n(s.assetsCreated)} new, ${n(s.assetsUpdated)} updated · Columns: ${n(s.attributesCreated)} new, ${n(s.attributesUpdated)} updated`,
      });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: ar ? "فشل التطبيق" : "Apply failed", description: err.message }),
  });

  const totalChanged = preview ? preview.assets.changed + preview.attributes.changed : 0;

  return (
    <>
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
      <Btn
        variant="outline"
        icon={<Upload className="h-4 w-4" />}
        loading={uploadMutation.isPending}
        onClick={() => fileRef.current?.click()}
      >
        {ar ? "استيراد ملف IKC" : "Import IKC file"}
      </Btn>

      <Dialog open={preview !== null} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-h-[86vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-primary" />
              {ar ? "مراجعة الاستيراد" : "Review import"}
            </DialogTitle>
            <DialogDescription className="truncate">
              {preview?.filename}
              {preview?.sheetNames?.length ? ` · ${preview.sheetNames.join(" · ")}` : ""}
            </DialogDescription>
          </DialogHeader>

          {preview && (
            <div className="space-y-5">
              {/* Summary tiles */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <SummaryCard label={ar ? "الأصول" : "Assets"} counts={preview.assets} ar={ar} />
                <SummaryCard label={ar ? "الأعمدة" : "Columns"} counts={preview.attributes} ar={ar} />
              </div>

              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <Info className="mt-px h-3.5 w-3.5 shrink-0" />
                <span>
                  {ar
                    ? "تُحفظ الصفوف الجديدة والحقول المتغيّرة فقط. الخلايا الفارغة لا تمسح أو تستبدل أي قيمة موجودة."
                    : "Only new rows and changed fields are saved. Blank cells never clear or overwrite existing values."}
                </span>
              </p>

              {preview.warnings.length > 0 && (
                <Alert tone="warning" title={ar ? "تنبيهات" : "Warnings"}>
                  <ul className="list-disc space-y-0.5 ps-4">
                    {preview.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </Alert>
              )}

              {!preview.hasChanges && (
                <Alert tone="success" title={ar ? "كل شيء محدّث" : "Everything is up to date"}>
                  {ar ? "لا توجد تغييرات لتطبيقها." : "There are no changes to apply."}
                </Alert>
              )}

              {/* Changed fields — the heart of a re-upload */}
              {preview.changedItems.length > 0 && (
                <section className="space-y-2">
                  <SectionTitle count={totalChanged}>{ar ? "الحقول المتغيّرة" : "Changed fields"}</SectionTitle>
                  <div className="max-h-72 space-y-2 overflow-y-auto pe-1">
                    {preview.changedItems.map((item, i) => (
                      <ChangedItem key={i} item={item} ar={ar} />
                    ))}
                  </div>
                  {preview.changedItemsTruncated > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {ar
                        ? `و ${n(preview.changedItemsTruncated)} عنصر آخر متغيّر سيُطبَّق أيضًا.`
                        : `…and ${n(preview.changedItemsTruncated)} more changed item(s) will also be applied.`}
                    </p>
                  )}
                </section>
              )}

              {/* New records preview */}
              {(preview.assets.new > 0 || preview.attributes.new > 0) && (
                <section className="space-y-3">
                  <SectionTitle>{ar ? "سجلات جديدة" : "New records"}</SectionTitle>
                  {preview.assets.new > 0 && (
                    <ChipRow
                      label={`${ar ? "أصول" : "Assets"} (${n(preview.assets.new)})`}
                      items={preview.newAssetSample.slice(0, 10)}
                      total={preview.assets.new}
                      ar={ar}
                    />
                  )}
                  {preview.attributes.new > 0 && (
                    <ChipRow
                      label={`${ar ? "أعمدة" : "Columns"} (${n(preview.attributes.new)})`}
                      items={preview.newAttributeSample.slice(0, 8).map((s) => s.split(" · ").pop() ?? s)}
                      total={preview.attributes.new}
                      ar={ar}
                    />
                  )}
                </section>
              )}
            </div>
          )}

          <DialogFooter className="mt-2">
            <Btn variant="outline" onClick={() => setPreview(null)}>
              {ar ? "إلغاء" : "Cancel"}
            </Btn>
            <Btn
              icon={<ArrowRight className="h-4 w-4" />}
              loading={applyMutation.isPending}
              disabled={!preview?.hasChanges}
              onClick={() => preview && applyMutation.mutate(preview.uploadId)}
            >
              {ar ? "تطبيق التغييرات" : "Apply changes"}
            </Btn>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SummaryCard({ label, counts, ar }: { label: string; counts: DiffCounts; ar: boolean }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Stat value={counts.new} label={ar ? "جديد" : "New"} tone={counts.new > 0 ? "success" : "muted"} />
        <Stat value={counts.changed} label={ar ? "متغيّر" : "Changed"} tone={counts.changed > 0 ? "warning" : "muted"} />
        <Stat value={counts.unchanged} label={ar ? "دون تغيير" : "Unchanged"} tone="muted" />
      </div>
    </div>
  );
}

function Stat({ value, label, tone }: { value: number; label: string; tone: "success" | "warning" | "muted" }) {
  const color = tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-muted-foreground";
  return (
    <div>
      <p className={cn("text-2xl font-semibold tabular-nums", color)}>{n(value)}</p>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  );
}

function SectionTitle({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <h3 className="text-sm font-semibold">
      {children}
      {count !== undefined && <span className="ms-1 font-normal text-muted-foreground">({n(count)})</span>}
    </h3>
  );
}

function ChipRow({ label, items, total, ar }: { label: string; items: string[]; total: number; ar: boolean }) {
  const remaining = total - items.length;
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((it, i) => (
          <span key={i} className="rounded-md border bg-muted/40 px-2 py-0.5 font-mono text-xs">
            {it}
          </span>
        ))}
        {remaining > 0 && (
          <span className="rounded-md px-2 py-0.5 text-xs text-muted-foreground">
            +{n(remaining)} {ar ? "أخرى" : "more"}
          </span>
        )}
      </div>
    </div>
  );
}

function ChangedItem({ item, ar }: { item: PreviewItem; ar: boolean }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="mb-2 flex items-center gap-2">
        <Badge variant="outline" className="text-[10px] uppercase">
          {item.kind === "asset" ? (ar ? "أصل" : "Asset") : (ar ? "عمود" : "Column")}
        </Badge>
        <span className="truncate text-sm font-medium">{item.name}</span>
      </div>
      <div className="space-y-1.5">
        {item.changes.map((c, i) => (
          <div key={i} className="grid grid-cols-[minmax(80px,auto)_1fr] items-baseline gap-x-3 gap-y-0.5 text-xs">
            <span className="truncate font-medium text-muted-foreground">{c.label}</span>
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-destructive line-through">
                {c.from || (ar ? "فارغ" : "empty")}
              </span>
              <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="rounded bg-success/10 px-1.5 py-0.5 text-foreground">
                {c.to || (ar ? "فارغ" : "empty")}
              </span>
            </span>
          </div>
        ))}
        {item.moreChanges > 0 && (
          <p className="text-xs text-muted-foreground">
            {ar ? `و ${n(item.moreChanges)} حقل آخر.` : `…and ${n(item.moreChanges)} more field(s)`}
          </p>
        )}
      </div>
    </div>
  );
}
