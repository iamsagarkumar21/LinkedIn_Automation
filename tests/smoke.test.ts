import { describe, it, expect } from "vitest";
import type { Topic } from "../src/types";
describe("scaffold", () => {
  it("types import and basic object conforms", () => {
    const t: Topic = { key: "k", title: "T", url: "u", source: "hn", score: 1 };
    expect(t.key).toBe("k");
  });
});
