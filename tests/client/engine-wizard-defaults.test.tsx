import { describe, expect, it } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LanguageProvider } from "@/context/LanguageContext";
import { EngineWizard } from "@/components/pdtc/EngineWizard";

/**
 * Proves the run-wizard seeds its Batch size + Self-consistency DEFAULTS from the saved
 * AI settings (/api/settings/ai), rather than the old hardcoded 25 / 1. We pre-populate the
 * query cache so no network is needed; the wizard's config step reads it on mount.
 */
function renderWizard(ai: { maxBatchSize: number; batchSize: number; selfConsistencySamples: number }) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, refetchOnMount: false, queryFn: async () => ({}) },
    },
  });
  // The only queries the config step reads with a "selected" scope.
  qc.setQueryData(["/api/settings/ai"], ai);
  qc.setQueryData(["/api/frameworks/pii"], { engineType: "pii", version: "1", definition: { criteria: [] } });

  return render(
    <QueryClientProvider client={qc}>
      <LanguageProvider>
        <EngineWizard
          engineType="pii"
          screen="attributes"
          selection={{ mode: "include", ids: [1], excluded: [] } as never}
          selectedCount={1}
          onClose={() => {}}
          initialScope="selected"
        />
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

// The wizard renders through a Radix portal (document.body). The two advanced number inputs
// are uniquely identifiable by their max attribute (batch size max=50, self-consistency max=9).
const batchInput = () => document.querySelector<HTMLInputElement>('input[type="number"][max="50"]');
const selfConsistencyInput = () => document.querySelector<HTMLInputElement>('input[type="number"][max="9"]');

describe("EngineWizard seeds run defaults from saved AI settings", () => {
  it("uses the saved batch size & self-consistency, not the hardcoded 25 / 1", async () => {
    renderWizard({ maxBatchSize: 5000, batchSize: 8, selfConsistencySamples: 3 });

    await waitFor(() => {
      expect(batchInput()?.value).toBe("8");
      expect(selfConsistencyInput()?.value).toBe("3");
    });
  });

  it("reflects a different saved configuration", async () => {
    renderWizard({ maxBatchSize: 5000, batchSize: 40, selfConsistencySamples: 5 });

    await waitFor(() => {
      expect(batchInput()?.value).toBe("40");
      expect(selfConsistencyInput()?.value).toBe("5");
    });
  });
});
