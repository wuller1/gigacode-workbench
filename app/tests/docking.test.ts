import { describe, it, expect } from "vitest";
import {
  dock,
  geometry,
  group,
  groups,
  ids,
  minimum,
  normalize,
  ratio,
  remove,
} from "../src/docking";
describe("desktop docking", () => {
  for (const edge of ["left", "right", "top", "bottom", "center"] as const)
    it(`moves an existing tab to ${edge} without duplicates or loss`, () => {
      let tree = group(["chat", "files", "browser"]);
      const result = dock(tree, "files", tree.id, edge);
      expect(ids(result).sort()).toEqual(["browser", "chat", "files"]);
      expect(groups(result).length).toBe(edge === "center" ? 1 : 2);
    });
  it("closes the final tab, collapses empty splits, and opens from an empty workspace", () => {
    const first = group(["chat"]);
    const split = dock(first, "files", first.id, "right");
    expect(remove(split, "files")).toEqual(first);
    expect(remove(first, "chat")).toBeNull();
    expect(ids(dock(null, "files"))).toEqual(["files"]);
  });
  it("restores malformed persisted layouts without duplicate tabs or node identities", () => {
    const result = normalize({
      kind: "split",
      id: "same",
      axis: "x",
      ratio: NaN,
      a: { kind: "group", id: "same", tabs: ["chat", "files", "invalid"] },
      b: { kind: "group", id: "same", tabs: ["chat", "browser"] },
    })!;
    expect(ids(result)).toEqual(["chat", "files", "browser"]);
    expect(new Set(groups(result).map((g) => g.id)).size).toBe(2);
  });
  it("keeps explicit splits at narrow desktop widths and computes non-overlapping bounds", () => {
    const start = group(["chat"]);
    let tree = dock(start, "files", start.id, "right");
    tree = dock(tree, "terminal", groups(tree)[1].id, "bottom");
    for (const width of [983, 1280, 1920]) {
      const min = minimum(tree),
        r = geometry(tree, {
          x: 0,
          y: 0,
          width: Math.max(min.width, width),
          height: 924,
        });
      expect(r.groups).toHaveLength(3);
      expect(r.splits).toHaveLength(2);
      for (const g of r.groups) {
        expect(g.rect.width).toBeGreaterThanOrEqual(280);
        expect(g.rect.height).toBeGreaterThanOrEqual(180);
      }
      for (let i = 0; i < r.groups.length; i++)
        for (let j = i + 1; j < r.groups.length; j++) {
          const a = r.groups[i].rect,
            b = r.groups[j].rect;
          expect(
            a.x + a.width <= b.x ||
              b.x + b.width <= a.x ||
              a.y + a.height <= b.y ||
              b.y + b.height <= a.y,
          ).toBe(true);
        }
    }
    const changed = ratio(tree, tree.id, 0.7);
    expect(ids(changed)).toEqual(ids(tree));
  });
});
