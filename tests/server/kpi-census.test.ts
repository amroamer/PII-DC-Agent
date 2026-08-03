import { describe, expect, it } from "vitest";

/**
 * The attribute KPI strip is a CLOSED PARTITION — the whole reason it replaced
 * the old tiles, which included two that could never be non-zero and a pair that
 * compared a filtered count against a global total:
 *
 *   pii + notPii + uncertain === analysed
 *   analysed + notAnalysed   === coverageScope
 *
 * These assert the arithmetic on the payload shape, so a future change that
 * scopes one tile differently from the others fails here rather than on screen.
 */
interface Kpis {
  coverageScope: number;
  analysed: number;
  notAnalysed: number;
  pii: number;
  notPii: number;
  uncertain: number;
}

function balances(k: Kpis) {
  return k.pii + k.notPii + k.uncertain === k.analysed && k.analysed + k.notAnalysed === k.coverageScope;
}

describe("attribute KPI census", () => {
  it("balances on the live catalog's real numbers", () => {
    // Measured from the DHABI catalog at the time this was written.
    expect(balances({ coverageScope: 26083, analysed: 5044, notAnalysed: 21039, pii: 827, notPii: 4072, uncertain: 145 })).toBe(true);
  });

  it("balances when scoped to a single import", () => {
    expect(balances({ coverageScope: 5052, analysed: 4846, notAnalysed: 206, pii: 809, notPii: 3893, uncertain: 144 })).toBe(true);
  });

  it("balances on an empty scope", () => {
    expect(balances({ coverageScope: 0, analysed: 0, notAnalysed: 0, pii: 0, notPii: 0, uncertain: 0 })).toBe(true);
  });

  it("balances when nothing has been analysed yet", () => {
    expect(balances({ coverageScope: 500, analysed: 0, notAnalysed: 500, pii: 0, notPii: 0, uncertain: 0 })).toBe(true);
  });

  it("catches a verdict tile scoped differently from the rest", () => {
    // The exact class of bug this guards: PII counted over the verdict-filtered
    // view while the others use the coverage scope.
    expect(balances({ coverageScope: 5052, analysed: 4846, notAnalysed: 206, pii: 0, notPii: 3893, uncertain: 144 })).toBe(false);
  });

  it("catches the old 'never' bug — a global total against a filtered count", () => {
    // 144 in view, 25,939 "never": the two came from different denominators.
    expect(balances({ coverageScope: 144, analysed: 144, notAnalysed: 25939, pii: 0, notPii: 0, uncertain: 144 })).toBe(false);
  });
});
