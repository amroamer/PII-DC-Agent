import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LanguageProvider } from "@/context/LanguageContext";
import { FilterPanel } from "@/components/pdtc/FilterPanel";
import { ATTRIBUTE_FILTERS } from "@shared/lib/filter-defs";

/**
 * The attribute filter panel had grown to ~46 controls, a third of which could
 * not match a row against a real catalog. These cover the three rules that
 * replaced it: a small default set, an opt-in advanced section, and per-feature
 * availability gating.
 */
function renderPanel(availability: Record<string, boolean>, filters: Record<string, unknown> = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false, queryFn: async () => ({}) } },
  });
  qc.setQueryData(["/api/catalog/filter-availability"], availability);
  return render(
    <QueryClientProvider client={qc}>
      <LanguageProvider>
        <FilterPanel screen="attributes" defs={ATTRIBUTE_FILTERS} filters={filters} onChange={() => {}} />
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

const NOTHING_ENABLED = {
  reviewItems: false,
  reviewAssignees: false,
  reviewResolvers: false,
  consentStatus: false,
  accessControlLevel: false,
  processingPurpose: false,
  specialCategory: false,
};

describe("<FilterPanel /> — attribute filters", () => {
  it("shows only the default set until the user asks for more", () => {
    renderPanel(NOTHING_ENABLED);
    // Default set.
    expect(screen.getByText("PII verdict")).toBeInTheDocument();
    expect(screen.getByText("Matched criterion")).toBeInTheDocument();
    expect(screen.getByText("Critical Data Element")).toBeInTheDocument();
    // Advanced, hidden.
    expect(screen.queryByText("Scale")).toBeNull();
    expect(screen.queryByText("Is primary key")).toBeNull();
    expect(screen.queryByText("Quality score")).toBeNull();
  });

  it("reveals the advanced filters on demand", async () => {
    const user = userEvent.setup();
    renderPanel(NOTHING_ENABLED);
    await user.click(screen.getByRole("button", { name: /More filters/ }));
    expect(screen.getByText("Scale")).toBeInTheDocument();
    expect(screen.getByText("Quality score")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Fewer filters/ })).toBeInTheDocument();
  });

  it("hides filters whose feature has no data, even under advanced", async () => {
    const user = userEvent.setup();
    renderPanel(NOTHING_ENABLED);
    await user.click(screen.getByRole("button", { name: /More filters/ }));
    // Review queue never built, governance metadata never captured, and no run
    // scored SPECIAL_CATEGORY — each of these could only return zero rows.
    expect(screen.queryByText("Review status")).toBeNull();
    expect(screen.queryByText("Assigned to")).toBeNull();
    expect(screen.queryByText("Consent status")).toBeNull();
    expect(screen.queryByText("Access control level")).toBeNull();
    expect(screen.queryByText("Processing purpose present")).toBeNull();
    expect(screen.queryByText("Special category")).toBeNull();
  });

  it("brings a gated filter back the moment its feature has data", async () => {
    const user = userEvent.setup();
    renderPanel({ ...NOTHING_ENABLED, reviewItems: true, specialCategory: true });
    await user.click(screen.getByRole("button", { name: /More filters/ }));
    expect(screen.getByText("Review status")).toBeInTheDocument();
    expect(screen.getByText("Special category")).toBeInTheDocument();
    // Still hidden — those features remain unused.
    expect(screen.queryByText("Consent status")).toBeNull();
  });

  it("keeps an advanced filter visible while it is applied", () => {
    // Otherwise an active filter could hide behind a collapsed section and the
    // user would see a filtered table with no visible cause.
    renderPanel(NOTHING_ENABLED, { qualityScore: { min: 50 } });
    expect(screen.getByText("Quality score")).toBeInTheDocument();
  });

  it("drops the filters that cannot match anything by construction", () => {
    const keys = ATTRIBUTE_FILTERS.map((d) => d.key);
    for (const gone of [
      "criteriaCount",
      "conflict",
      "cooccurrence",
      "assetType",
      "storage",
      "piiName",
      "hasBusinessTerms",
      "hasSuggestedTerms",
      "classificationSource",
    ]) {
      expect(keys).not.toContain(gone);
    }
  });

  it("keeps the default set small enough to read at a glance", () => {
    // Deliberately tight: the panel renders in three columns and must not need
    // scrolling. Raising this bound should be a decision, not a side effect —
    // it went 12 -> 13 when the Import (old vs new catalog) filter was added.
    const defaults = ATTRIBUTE_FILTERS.filter((d) => !d.advanced);
    expect(defaults.length).toBeLessThanOrEqual(13);
    expect(defaults.map((d) => d.key)).toContain("verdict");
    expect(defaults.map((d) => d.key)).toContain("importBatch");
  });
});
