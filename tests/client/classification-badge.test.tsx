import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LanguageProvider } from "@/context/LanguageContext";
import { ClassificationBadge } from "@/components/pdtc/ClassificationBadge";
import { CLASSIFICATION_LEVELS_LIST } from "@shared/lib/classification";

function renderBadge(levels?: unknown) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false, queryFn: async () => ({}) } },
  });
  if (levels !== undefined) {
    qc.setQueryData(["/api/frameworks/classification"], { definition: { levels } });
  }
  return render(
    <QueryClientProvider client={qc}>
      <LanguageProvider>
        <ClassificationBadge code="SECRET" />
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

describe("ClassificationBadge reflects the active framework levels", () => {
  it("shows the steward's renamed label instead of the hardcoded default", async () => {
    const renamed = CLASSIFICATION_LEVELS_LIST.map((l) =>
      l.code === "SECRET" ? { ...l, labelEn: "Top Secret" } : l,
    );
    renderBadge(renamed);
    await waitFor(() => expect(screen.getByText("Top Secret")).toBeInTheDocument());
    expect(screen.queryByText("Secret")).toBeNull();
  });

  it("falls back to the hardcoded default label when the framework is unavailable", async () => {
    renderBadge(undefined);
    await waitFor(() => expect(screen.getByText("Secret")).toBeInTheDocument());
  });
});
