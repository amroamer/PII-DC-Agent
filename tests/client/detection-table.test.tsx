import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LanguageProvider } from "@/context/LanguageContext";
import DetectionPage from "@/pages/detection";

/**
 * The detection table used to show Verdict / Criterion / Confidence / Layers — all
 * four constant on the first screen of a run — while the rationale the engine had
 * already returned was dropped on the floor. These cover what the row now says.
 */
function result(over: Record<string, unknown> = {}) {
  const merged = {
    verdict: "pii",
    criterion: "DIRECT_ID",
    dataClassCode: "EMIRATES_ID",
    confidence: 0.93,
    rationaleEn: "Column name and IKC data class both indicate an Emirates ID number.",
    rationaleAr: "يشير اسم العمود وفئة البيانات إلى رقم هوية إماراتية.",
    conflict: false,
    contributingLayers: ["llm"],
    nearThreshold: false,
    ...(over.merged as object),
  };
  return {
    attributeId: 1,
    columnName: "AADID",
    assetId: 10,
    assetName: "HUD_EMPLOYEES",
    layers: [{ id: 1, layer: "llm", verdict: merged.verdict, confidence: merged.confidence }],
    ...over,
    merged,
  };
}

function renderPage(results: Array<ReturnType<typeof result>>) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false, queryFn: async () => ({}) } },
  });
  qc.setQueryData(["/api/catalog/attributes?filters=%7B%7D&page=1&pageSize=1"], { total: results.length });
  qc.setQueryData(["/api/pii-detection/results?page=1&pageSize=50"], {
    runId: "15",
    count: results.length,
    page: 1,
    pageSize: 50,
    results,
  });

  return render(
    <QueryClientProvider client={qc}>
      <LanguageProvider>
        <DetectionPage />
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

describe("<DetectionPage /> results table", () => {
  it("renders the engine's rationale, which the table previously discarded", async () => {
    renderPage([result()]);
    await waitFor(() =>
      expect(screen.getByText("Column name and IKC data class both indicate an Emirates ID number.")).toBeInTheDocument(),
    );
  });

  it("renders the detected data class", async () => {
    renderPage([result()]);
    await waitFor(() => expect(screen.getByText("EMIRATES_ID")).toBeInTheDocument());
  });

  it("shows a plain percentage instead of a meter when confidence carries no signal", async () => {
    renderPage([result({ merged: { verdict: "not_pii", criterion: null, dataClassCode: null, confidence: 0.99 } })]);
    await waitFor(() => expect(screen.getByText("99%")).toBeInTheDocument());
    // The ConfidenceBar's meter track is only rendered for the doubtful rows.
    expect(document.querySelector(".w-20")).toBeNull();
  });

  it("keeps the meter for a low-confidence row", async () => {
    renderPage([result({ merged: { confidence: 0.55, verdict: "uncertain", nearThreshold: true } })]);
    await waitFor(() => expect(screen.getByText("55%")).toBeInTheDocument());
    expect(document.querySelector(".w-20")).not.toBeNull();
  });

  it("suppresses the layer chip when a single agreeing layer would say nothing", async () => {
    renderPage([result()]);
    await waitFor(() => expect(screen.getByText("AADID")).toBeInTheDocument());
    expect(screen.queryByText("LLM")).toBeNull();
  });

  it("drops a column entirely when no row on the page has that signal", async () => {
    // Every row here is a lone agreeing LLM verdict whose data class just repeats
    // the criterion — the exact shape of this catalog's runs. Neither header
    // should occupy space.
    renderPage([result({ merged: { dataClassCode: "DIRECT_ID" } })]);
    await waitFor(() => expect(screen.getByText("AADID")).toBeInTheDocument());
    // Scoped to the header row — "Criterion" is also a filter label.
    const head = within(document.querySelector("thead")!);
    expect(head.queryByText("Data class")).toBeNull();
    expect(head.queryByText("Layers")).toBeNull();
    // The columns that do carry a signal stay put.
    expect(head.getByText("Why")).toBeInTheDocument();
    expect(head.getByText("Criterion")).toBeInTheDocument();
  });

  it("keeps the data class column when a row has a real class", async () => {
    renderPage([result()]);
    await waitFor(() => expect(screen.getByText("Data class")).toBeInTheDocument());
  });

  it("marks the dissenting layer when layers disagree", async () => {
    renderPage([
      result({
        merged: { verdict: "uncertain", conflict: true, confidence: 0.8 },
        layers: [
          { id: 1, layer: "llm", verdict: "pii", confidence: 0.8 },
          { id: 2, layer: "ikc_class", verdict: "not_pii", confidence: 0.7 },
        ],
      }),
    ]);
    // Scoped by the chip's tooltip: the rationale text also mentions "IKC".
    await waitFor(() => expect(document.querySelector('[title^="IKC:"]')).not.toBeNull());
    // Both layers dissent from the merged "uncertain" verdict, so both are marked.
    expect(document.querySelector('[title^="IKC:"]')?.textContent).toContain("✕");
    expect(document.querySelector('[title^="LLM:"]')?.textContent).toContain("✕");
  });

  it("paginates rather than rendering a whole run into the DOM", async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false, queryFn: async () => ({}) } },
    });
    qc.setQueryData(["/api/catalog/attributes?filters=%7B%7D&page=1&pageSize=1"], { total: 1231 });
    qc.setQueryData(["/api/pii-detection/results?page=1&pageSize=50"], {
      runId: "15",
      count: 1231,
      page: 1,
      pageSize: 50,
      results: [result()],
    });
    render(
      <QueryClientProvider client={qc}>
        <LanguageProvider>
          <DetectionPage />
        </LanguageProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText("1–50 of 1231")).toBeInTheDocument());
    expect(screen.getByText("1 / 25")).toBeInTheDocument();
  });
});
