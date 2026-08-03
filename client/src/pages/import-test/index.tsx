import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, FileUp, Search, Trash2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLanguage } from "@/hooks/useLanguage";
import { useToast } from "@/hooks/use-toast";
import { formatDateTime } from "@/lib/formatDate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Btn } from "@/components/pdtc/Btn";
import { EmptyState } from "@/components/pdtc/EmptyState";

interface StoredFile {
  id: number;
  filename: string;
  mimeType: string | null;
  size: number;
  createdAt: string;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function triggerDownload(url: string, filename?: string) {
  const a = document.createElement("a");
  a.href = url;
  if (filename) a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export default function ImportTestPage() {
  const { lang } = useLanguage();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [zipping, setZipping] = useState(false);

  const filesQuery = useQuery<StoredFile[]>({ queryKey: [`/api/files?search=${encodeURIComponent(search)}`] });
  const files = filesQuery.data ?? [];

  const uploadMutation = useMutation({
    mutationFn: async (files: File[]) => {
      const form = new FormData();
      files.forEach((f) => form.append("files", f));
      const res = await fetch("/api/files", { method: "POST", body: form, credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message ?? "Upload failed");
      return (await res.json()) as { uploaded: number };
    },
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: [`/api/files?search=${encodeURIComponent(search)}`] });
      toast({ title: `${r.uploaded} file(s) uploaded` });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "Upload failed", description: err.message }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/files/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/files?search=${encodeURIComponent(search)}`] }),
  });

  const deleteSelected = async () => {
    for (const id of selected) await deleteMutation.mutateAsync(id);
    setSelected(new Set());
    toast({ title: "Deleted" });
  };

  const downloadZip = async () => {
    setZipping(true);
    try {
      const res = await fetch("/api/files/download-zip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected] }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Zip download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      triggerDownload(url, "pdtc-files.zip");
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({ variant: "destructive", title: "Download failed", description: (err as Error).message });
    } finally {
      setZipping(false);
    }
  };

  const allSelected = files.length > 0 && files.every((f) => selected.has(f.id));
  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(files.map((f) => f.id)));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{lang === "ar" ? "اختبار الاستيراد" : "Import Test"}</h1>
        <p className="text-sm text-muted-foreground">
          {lang === "ar"
            ? "ارفع الملفات وخزّنها في قاعدة البيانات — تبقى بعد إعادة النشر. ابحث، نزّل، أو احذف."
            : "Upload files stored in the database — they persist across redeploys. Search, download, or delete."}
        </p>
      </header>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileUp className="h-4 w-4" /> {lang === "ar" ? "رفع الملفات" : "Upload files"}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              // Snapshot the picked files into a stable array *before* clearing the
              // input. e.target.files is a LIVE FileList tied to the input, and
              // `e.target.value = ""` empties it synchronously. react-query runs the
              // mutationFn asynchronously, so reading the FileList inside the mutation
              // would find zero files (→ 400 "No files uploaded"). Array.from() here
              // captures the File objects while they still exist.
              const picked = e.target.files ? Array.from(e.target.files) : [];
              e.target.value = "";
              if (picked.length) uploadMutation.mutate(picked);
            }}
          />
          <Btn icon={<FileUp className="h-4 w-4" />} loading={uploadMutation.isPending} onClick={() => fileRef.current?.click()}>
            {lang === "ar" ? "اختر ملفات" : "Choose files"}
          </Btn>
          <span className="text-xs text-muted-foreground">{lang === "ar" ? "حتى 20 ملفاً، 200 ميغابايت لكل ملف" : "Up to 20 files, 200 MB each"}</span>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base">{lang === "ar" ? "الملفات" : "Files"} ({files.length})</CardTitle>
            <div className="relative ms-auto min-w-[200px] flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={lang === "ar" ? "بحث بالاسم…" : "Search by name…"} className="ps-9" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/40 bg-primary/5 p-2">
              <span className="text-sm font-medium">{selected.size} {lang === "ar" ? "محدد" : "selected"}</span>
              <div className="flex-1" />
              <Btn size="sm" variant="outline" icon={<Download className="h-4 w-4" />} loading={zipping} onClick={downloadZip}>
                {lang === "ar" ? "تنزيل (zip)" : "Download (zip)"}
              </Btn>
              <Button size="sm" variant="outline" onClick={deleteSelected}><Trash2 className="h-4 w-4" /> {lang === "ar" ? "حذف" : "Delete"}</Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>{lang === "ar" ? "إلغاء" : "Clear"}</Button>
            </div>
          )}

          {files.length === 0 ? (
            <EmptyState
              icon={<FileUp className="h-6 w-6" />}
              title={filesQuery.isLoading ? (lang === "ar" ? "جارٍ التحميل…" : "Loading…") : search ? (lang === "ar" ? "لا نتائج" : "No matches") : (lang === "ar" ? "لا ملفات بعد" : "No files yet")}
              description={search ? undefined : lang === "ar" ? "ارفع ملفاً للبدء." : "Upload a file to get started."}
            />
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"><Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="select all" /></TableHead>
                    <TableHead>{lang === "ar" ? "الاسم" : "Name"}</TableHead>
                    <TableHead>{lang === "ar" ? "الحجم" : "Size"}</TableHead>
                    <TableHead>{lang === "ar" ? "تاريخ الرفع" : "Uploaded"}</TableHead>
                    <TableHead className="text-end">{lang === "ar" ? "إجراءات" : "Actions"}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {files.map((f) => (
                    <TableRow key={f.id} data-state={selected.has(f.id) ? "selected" : undefined}>
                      <TableCell><Checkbox checked={selected.has(f.id)} onCheckedChange={() => toggle(f.id)} aria-label={`select ${f.filename}`} /></TableCell>
                      <TableCell className="font-medium">{f.filename}</TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">{formatBytes(f.size)}</TableCell>
                      <TableCell className="text-muted-foreground">{formatDateTime(f.createdAt)}</TableCell>
                      <TableCell className="text-end">
                        <div className="flex items-center justify-end gap-1">
                          <Button size="icon" variant="ghost" className="h-8 w-8" title="Download" onClick={() => triggerDownload(`/api/files/${f.id}/download`, f.filename)}>
                            <Download className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8" title="Delete" onClick={() => deleteMutation.mutate(f.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
