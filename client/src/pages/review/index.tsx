import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLanguage } from "@/hooks/useLanguage";
import { useToast } from "@/hooks/use-toast";
import { CLASSIFICATION_CODES, type ClassificationCode } from "@shared/lib/classification";
import { isCriterionCode } from "@shared/lib/criteria";
import type { DetectionVerdict, ReviewStatus } from "@shared/models/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Btn } from "@/components/pdtc/Btn";
import { DataTable, type Column } from "@/components/pdtc/DataTable";
import { VerdictPill } from "@/components/pdtc/Pill";
import { CriterionBadge } from "@/components/pdtc/CriterionBadge";
import { ConfidenceBar } from "@/components/pdtc/ConfidenceBar";
import { Modal } from "@/components/pdtc/Modal";

type Decision = "accepted" | "rejected" | "overridden";

interface ReviewItemView {
  id: number;
  targetId: number;
  status: ReviewStatus;
  priority: number;
  columnName: string | null;
  assetName: string | null;
  verdict: DetectionVerdict | null;
  criterionCode: string | null;
  confidence: number | null;
}

export default function ReviewPage() {
  const { t, lang } = useLanguage();
  const { toast } = useToast();
  const [status, setStatus] = useState<string>("pending");
  const [active, setActive] = useState<{ item: ReviewItemView; decision: Decision } | null>(null);
  const [rationale, setRationale] = useState("");
  const [overrideLevel, setOverrideLevel] = useState<ClassificationCode>("CONFIDENTIAL");

  const itemsQuery = useQuery<ReviewItemView[]>({
    queryKey: [`/api/review/items?status=${status}`],
  });

  const decisionMutation = useMutation({
    mutationFn: (payload: {
      reviewItemId: number;
      decision: Decision;
      rationale: string;
      overrideLevelCode?: ClassificationCode;
    }) => apiRequest("POST", "/api/review/decision", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/review/items?status=${status}`] });
      setActive(null);
      setRationale("");
      toast({ title: "Decision recorded", description: "Written to the audit log." });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "Failed", description: err.message }),
  });

  const priorityBadge = (p: number) => (
    <Badge variant={p >= 100 ? "destructive" : p >= 80 ? "warning" : "secondary"}>{p}</Badge>
  );

  const columns: Column<ReviewItemView>[] = [
    { key: "priority", header: t("field.priority"), render: (r) => priorityBadge(r.priority) },
    {
      key: "column",
      header: t("field.column"),
      render: (r) => (
        <div>
          <p className="font-medium">{r.columnName ?? "—"}</p>
          <p className="text-xs text-muted-foreground">{r.assetName}</p>
        </div>
      ),
    },
    { key: "verdict", header: t("field.verdict"), render: (r) => (r.verdict ? <VerdictPill verdict={r.verdict} /> : "—") },
    {
      key: "criterion",
      header: t("field.criterion"),
      render: (r) => (isCriterionCode(r.criterionCode) ? <CriterionBadge code={r.criterionCode} /> : <span className="text-muted-foreground">—</span>),
    },
    { key: "confidence", header: t("field.confidence"), render: (r) => (r.confidence != null ? <ConfidenceBar value={r.confidence} /> : "—") },
    {
      key: "status",
      header: t("field.status"),
      render: (r) =>
        r.status === "pending" ? (
          <div className="flex gap-1">
            <Button size="sm" variant="outline" onClick={() => { setActive({ item: r, decision: "accepted" }); setRationale(""); }}>{t("action.accept")}</Button>
            <Button size="sm" variant="outline" onClick={() => { setActive({ item: r, decision: "rejected" }); setRationale(""); }}>{t("action.reject")}</Button>
            <Button size="sm" variant="outline" onClick={() => { setActive({ item: r, decision: "overridden" }); setRationale(""); }}>{t("action.override")}</Button>
          </div>
        ) : (
          <Badge variant="secondary">{r.status}</Badge>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("review.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {lang === "ar" ? "قبول أو رفض أو تجاوز نتائج المحرك — كل قرار يتطلب مبرراً." : "Accept, reject, or override engine findings — every decision needs a rationale."}
          </p>
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            {["pending", "accepted", "rejected", "overridden"].map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </header>

      <Card><CardContent className="pt-6">
        <DataTable
          columns={columns}
          rows={itemsQuery.data ?? []}
          getRowKey={(r) => r.id}
          loading={itemsQuery.isLoading}
          emptyTitle="Queue is empty"
          emptyDescription="Run the detection engine to populate the review queue."
        />
      </CardContent></Card>

      <Modal
        open={active !== null}
        onOpenChange={(open) => !open && setActive(null)}
        title={active ? `${t(`action.${active.decision === "accepted" ? "accept" : active.decision === "rejected" ? "reject" : "override"}`)} — ${active.item.columnName ?? ""}` : ""}
        description={lang === "ar" ? "المبرر مطلوب لحل عنصر المراجعة." : "A rationale is required to resolve this review item."}
        footer={
          <>
            <Button variant="outline" onClick={() => setActive(null)}>{t("action.cancel")}</Button>
            <Btn
              loading={decisionMutation.isPending}
              disabled={rationale.trim().length === 0}
              onClick={() =>
                active &&
                decisionMutation.mutate({
                  reviewItemId: active.item.id,
                  decision: active.decision,
                  rationale,
                  overrideLevelCode: active.decision === "overridden" ? overrideLevel : undefined,
                })
              }
            >
              {t("action.save")}
            </Btn>
          </>
        }
      >
        <div className="space-y-3">
          {active?.decision === "overridden" && (
            <div className="space-y-1.5">
              <Label>{t("field.level")}</Label>
              <Select value={overrideLevel} onValueChange={(v) => setOverrideLevel(v as ClassificationCode)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CLASSIFICATION_CODES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>{t("field.rationale")} *</Label>
            <Textarea value={rationale} onChange={(e) => setRationale(e.target.value)} rows={3} />
          </div>
        </div>
      </Modal>
    </div>
  );
}
