import { describe, expect, it } from "vitest";
import { fuzzyMatch } from "./RichTextEditor";

describe("Section 11.5 @mention fuzzy filter", () => {
  it("matches letters in order, ignoring case", () => {
    expect(fuzzyMatch("Sam Contributor", "sam")).toBe(true);
    expect(fuzzyMatch("Sam Contributor", "scon")).toBe(true);
    expect(fuzzyMatch("Sam Contributor", "SC")).toBe(true);
    expect(fuzzyMatch("Sam Contributor", "")).toBe(true);
    expect(fuzzyMatch("Sam Contributor", "cs")).toBe(false);
    expect(fuzzyMatch("Sam Contributor", "samx")).toBe(false);
  });
});
