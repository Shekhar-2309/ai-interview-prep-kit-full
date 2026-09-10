import { describe, it, expect } from "vitest";
import {
  markGenerated,
  markEdited,
  markManual,
  regenerateCategory,
  regenerateSection,
  moveToCategory,
  WithMeta,
} from "./kitState";

interface Q {
  id: string;
  category: string;
  requirement_ids: string[];
  prompt: string;
}

describe("regenerateCategory", () => {
  it("keeps edited and manual items untouched, replaces only generated ones", () => {
    const items: WithMeta<Q>[] = [
      markGenerated({ id: "q1", category: "technical", requirement_ids: ["r1"], prompt: "old" }),
      markEdited({ id: "q2", category: "technical", requirement_ids: ["r2"], prompt: "user edited this" } as any),
      markManual({ id: "q3", category: "technical", requirement_ids: ["r3"], prompt: "user wrote this" }),
      markGenerated({ id: "q4", category: "behavioural", requirement_ids: ["r4"], prompt: "other category" }),
    ];

    const result = regenerateCategory(items, "technical", (reqIds) => {
      // fresh generation should only be asked about r1 (the only requirement not
      // already covered by a locked item within this category)
      expect(reqIds).toEqual(["r1"]);
      return [markGenerated({ id: "q1-new", category: "technical", requirement_ids: reqIds, prompt: "fresh" })];
    });

    const ids = result.map((r) => r.id);
    expect(ids).toContain("q2"); // edited survives
    expect(ids).toContain("q3"); // manual survives
    expect(ids).toContain("q4"); // untouched, different category, unaffected
    expect(ids).toContain("q1-new"); // generated item replaced
    expect(ids).not.toContain("q1"); // old generated item is gone
  });

  it("produces no fresh generation call requirements when all items in category are locked", () => {
    const items: WithMeta<Q>[] = [
      markManual({ id: "q1", category: "technical", requirement_ids: ["r1"], prompt: "manual" }),
    ];
    const result = regenerateCategory(items, "technical", (reqIds) => {
      expect(reqIds).toEqual([]);
      return [];
    });
    expect(result.map((r) => r.id)).toEqual(["q1"]);
  });
});

describe("regenerateSection", () => {
  it("does not overwrite a locked (edited) section unless forced", () => {
    const current = markEdited({ summary: "user's own summary" } as any);
    const result = regenerateSection(current, () => ({ summary: "fresh from model" }));
    expect((result as any).summary).toBe("user's own summary");
  });

  it("overwrites when forced", () => {
    const current = markEdited({ summary: "user's own summary" } as any);
    const result = regenerateSection(current, () => ({ summary: "fresh from model" }), true);
    expect((result as any).summary).toBe("fresh from model");
    expect(result._meta.origin).toBe("generated");
  });

  it("freely overwrites an untouched generated section", () => {
    const current = markGenerated({ summary: "old" });
    const result = regenerateSection(current, () => ({ summary: "new" }));
    expect((result as any).summary).toBe("new");
  });
});

describe("moveToCategory", () => {
  it("marks the item as edited so it survives regeneration of either category", () => {
    const item = markGenerated({ id: "q1", category: "technical", requirement_ids: [], prompt: "x" });
    const moved = moveToCategory(item, "behavioural");
    expect(moved.category).toBe("behavioural");
    expect(moved._meta.locked).toBe(true);
    expect(moved._meta.origin).toBe("edited");
  });
});
