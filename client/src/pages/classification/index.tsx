import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Play, PencilLine } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLanguage } from "@/hooks/useLanguage";
import { useToast } from "@/hooks/use-toast";
import {
  CLASSIFICATION_CODES,
  type ClassificationCode,
} from "@shared/lib/classification";
import type { ClassificationScope } from "@shared/models/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Btn } from "@/components/pdtc/Btn";
import { DataTable, type Column } from "@/components/pdtc/DataTable";
import { ClassificationBadge } from "@/components/pdtc/ClassificationBadge";
import { Modal } from "@/components/pdtc/Modal";
import { Alert } from "@/components/pdtc/Alert";
import { EngineWizard } from "@/components/pdtc/EngineWizard";
import { AttributeDetailDrawer } from "@/components/pdtc/AttributeDetailDrawer";
import { AssetDetailDrawer } from "@/components/pdtc/AssetDetailDrawer";
import type { Selection } from "@/hooks/useSelection";

const ALL_ATTRS: Selection = { mode: "all-matching", filters: {}, excluded: [] };

interface AttrClass {
  attributeId: number;
  columnName: string;
  assetName: string;
  levelCode: ClassificationCode;
  derivedFrom: string;
  rationale: string | null;
}
interface AssetClass {
  assetId: number;
  assetName: string;
  levelCode: ClassificationCode;
  derivedFrom: string;
  rationale: string | null;
  piiFlag: boolean;
  cdeFlag: boolean;
}

interface OverrideTarget {
  scope: ClassificationScope;
  targetId: number;
  label: string;
  current: ClassificationCode;
}

export default function ClassificationPage() {
  const { t, lang } = useLanguage();
  const { toast } = useToast();
  const [target, setTarget] = useState<OverrideTarget | null>(null);
  const [level, setLevel] = useState<ClassificationCode>("CONFIDENTIAL");
  const [rationale, setRationale] = useState("");

  const attrsQuery = useQuery<AttrClass[]>({ queryKey: ["/api/classification/attributes"] });
  const assetsQuery = useQuery<AssetClass[]>({ queryKey: ["/api/classification/assets"] });

  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardScope, setWizardScope] = useState<"all" | "remaining">("all");
  const [attrDetailId, setAttrDetailId] = useState<number | null>(null);
  const [assetDetailId, setAssetDetailId] = useState<number | null>(null);
  const totalQuery = useQuery<{ total: number }>({ queryKey: ["/api/catalog/attributes?filters=%7B%7D&page=1&pageSize=1"] });

  const overrideMutation = useMutation({
    mutationFn: (payload: { scope: ClassificationScope; targetId: number; levelCode: ClassificationCode; rationale: string }) =>
      apiRequest("POST", "/api/classification/override", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/classification/attributes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/classification/assets"] });
      setTarget(null);
      setRationale("");
      toast({ title: "Override recorded", description: "Written to the audit log." });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "Override failed", description: err.message }),
  });

  function beginOverride(t: OverrideTarget) {
    setTarget(t);
    setLevel(t.current);
    setRationale("");
  }

  const derivedBadge = (derivedFrom: string) => (
    <Badge variant={derivedFrom === "override" ? "warning" : "secondary"}>{derivedFrom}</Badge>
  );

  const attrColumns: Column<AttrClass>[] = [
    {
      key: "column",
      header: t("field.column"),
      render: (r) => (
        <div>
          <p className="font-medium">{r.columnName}</p>
          <p className="text-xs text-muted-foreground">{r.assetName}</p>
        </div>
      ),
    },
    { key: "level", header: t("field.level"), render: (r) => <ClassificationBadge code={r.levelCode} /> },
    { key: "derivedFrom", header: "Source", render: (r) => derivedBadge(r.derivedFrom) },
    { key: "rationale", header: t("field.rationale"), render: (r) => <span className="text-xs text-muted-foreground">{r.rationale}</span> },
    {
      key: "actions",
      header: "",
      render: (r) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => { e.stopPropagation(); beginOverride({ scope: "attribute", targetId: r.attributeId, label: r.columnName, current: r.levelCode }); }}
        >
          <PencilLine className="h-4 w-4" /> {t("action.override")}
        </Button>
      ),
    },
  ];

  const assetColumns: Column<AssetClass>[] = [
    { key: "assetName", header: t("field.asset"), render: (r) => <span className="font-medium">{r.assetName}</span> },
    { key: "level", header: t("field.level"), render: (r) => <ClassificationBadge code={r.levelCode} /> },
    { key: "derivedFrom", header: "Source", render: (r) => derivedBadge(r.derivedFrom) },
    {
      key: "flags",
      header: "Flags",
      render: (r) => (
        <div className="flex gap-1">
          {r.piiFlag && <Badge variant="destructive">PII</Badge>}
          {r.cdeFlag && <Badge variant="warning">CDE</Badge>}
        </div>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (r) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => { e.stopPropagation(); beginOverride({ scope: "asset", targetId: r.assetId, label: r.assetName, current: r.levelCode }); }}
        >
          <PencilLine className="h-4 w-4" /> {t("action.override")}
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("classification.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {lang === "ar"
              ? "اشتقاق تصنيفات السرية من قرارات الكشف وتجميعها على مستوى الأصل."
              : "Derive confidentiality labels from PII verdicts and roll them up to asset level."}
          </p>
        </div>
        <div className="flex gap-2">
          <Btn variant="outline" onClick={() => { setWizardScope("remaining"); setWizardOpen(true); }}>
            {lang === "ar" ? "تشغيل المتبقّي" : "Run the remaining"}
          </Btn>
          <Btn icon={<Play className="h-4 w-4" />} onClick={() => { setWizardScope("all"); setWizardOpen(true); }}>
            {lang === "ar" ? "تشغيل التصنيف" : "Run classification"}
          </Btn>
        </div>
      </header>

      <Tabs defaultValue="attributes">
        <TabsList>
          <TabsTrigger value="attributes">{t("classification.attributes")}</TabsTrigger>
          <TabsTrigger value="assets">{t("classification.assets")}</TabsTrigger>
        </TabsList>
        <TabsContent value="attributes">
          <Card><CardContent className="pt-6">
            <DataTable columns={attrColumns} rows={attrsQuery.data ?? []} getRowKey={(r) => r.attributeId} loading={attrsQuery.isLoading} onRowClick={(r) => setAttrDetailId(r.attributeId)} emptyTitle="No attribute classifications" emptyDescription="Run the classification engine after a detection run." />
          </CardContent></Card>
        </TabsContent>
        <TabsContent value="assets">
          <Card><CardContent className="pt-6">
            <DataTable columns={assetColumns} rows={assetsQuery.data ?? []} getRowKey={(r) => r.assetId} loading={assetsQuery.isLoading} onRowClick={(r) => setAssetDetailId(r.assetId)} emptyTitle="No asset rollups" />
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      <Modal
        open={target !== null}
        onOpenChange={(open) => !open && setTarget(null)}
        title={`${t("action.override")} — ${target?.label ?? ""}`}
        description={lang === "ar" ? "يتطلب التجاوز مبرراً ويُسجَّل في سجل التدقيق." : "An override requires a justification and is written to the audit log."}
        footer={
          <>
            <Button variant="outline" onClick={() => setTarget(null)}>{t("action.cancel")}</Button>
            <Btn
              loading={overrideMutation.isPending}
              disabled={rationale.trim().length === 0}
              onClick={() => target && overrideMutation.mutate({ scope: target.scope, targetId: target.targetId, levelCode: level, rationale })}
            >
              {t("action.save")}
            </Btn>
          </>
        }
      >
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>{t("field.level")}</Label>
            <Select value={level} onValueChange={(v) => setLevel(v as ClassificationCode)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CLASSIFICATION_CODES.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t("classification.rationale")} *</Label>
            <Textarea value={rationale} onChange={(e) => setRationale(e.target.value)} rows={3} placeholder={lang === "ar" ? "سبب التجاوز…" : "Reason for the override…"} />
          </div>
          {rationale.trim().length === 0 && <Alert tone="warning" title="A justification is required." />}
        </div>
      </Modal>

      {wizardOpen && (
        <EngineWizard
          engineType="classification"
          screen="attributes"
          selection={ALL_ATTRS}
          selectedCount={totalQuery.data?.total ?? 0}
          initialScope={wizardScope}
          onClose={() => setWizardOpen(false)}
        />
      )}

      <AttributeDetailDrawer id={attrDetailId} defaultTab="classification" onClose={() => setAttrDetailId(null)} />
      <AssetDetailDrawer id={assetDetailId} defaultTab="classification" onClose={() => setAssetDetailId(null)} onOpenAttribute={setAttrDetailId} />
    </div>
  );
}
