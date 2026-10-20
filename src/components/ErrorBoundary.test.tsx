import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ERROR_BOUNDARY_COPY, ErrorBoundary } from "./ErrorBoundary";

// Section 11.13: a crash shows a contained message, is reported, and never shows internals.

function Boom(): never {
  throw new Error("secret internal detail at /worker/x.ts:42");
}

describe("Section 11.13 error boundaries", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows the section 14 copy and a refresh button, not the error, and reports it", () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <div>
        <p>Navigation still here</p>
        <ErrorBoundary section="board">
          <Boom />
        </ErrorBoundary>
      </div>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(ERROR_BOUNDARY_COPY);
    expect(screen.getByRole("button", { name: "Refresh the page" })).toBeInTheDocument();
    expect(screen.queryByText(/secret internal detail/)).toBeNull();
    expect(screen.getByText("Navigation still here")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/client-errors", expect.objectContaining({ method: "POST" }));
    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    expect(body).toMatchObject({ section: "board" });
  });
});
