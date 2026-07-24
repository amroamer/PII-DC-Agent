import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConfidenceBar } from "@/components/pdtc/ConfidenceBar";

describe("<ConfidenceBar />", () => {
  it("renders the confidence as a rounded percentage", () => {
    render(<ConfidenceBar value={0.756} />);
    expect(screen.getByText("76%")).toBeInTheDocument();
  });

  it("clamps values above 1 to 100%", () => {
    render(<ConfidenceBar value={1.4} />);
    expect(screen.getByText("100%")).toBeInTheDocument();
  });
});
