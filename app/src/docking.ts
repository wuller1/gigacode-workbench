export type DockId =
  | "chat"
  | "files"
  | "plan"
  | "browser"
  | "terminal"
  | "artifacts"
  | "changes"
  | "workers"
  | "data";
// Database tools share the same editor-group docking behavior as IDE/browser.
export type Edge = "left" | "right" | "top" | "bottom" | "center";
export type Group = {
  kind: "group";
  id: string;
  tabs: DockId[];
  active: DockId;
};
export type DockTree =
  | Group
  | {
      kind: "split";
      id: string;
      axis: "x" | "y";
      ratio: number;
      a: DockTree;
      b: DockTree;
    };
export type Rect = { x: number; y: number; width: number; height: number };
export const validIds: DockId[] = [
  "chat",
  "files",
  "plan",
  "browser",
  "terminal",
  "artifacts",
  "changes",
  "workers",
  "data",
];
const uid = () => crypto.randomUUID();
export const group = (tabs: DockId[]): Group => ({
  kind: "group",
  id: uid(),
  tabs,
  active: tabs[0],
});
export function ids(tree: DockTree | null): DockId[] {
  return !tree
    ? []
    : tree.kind === "group"
      ? tree.tabs
      : [...ids(tree.a), ...ids(tree.b)];
}
export function groups(tree: DockTree | null): Group[] {
  return !tree
    ? []
    : tree.kind === "group"
      ? [tree]
      : [...groups(tree.a), ...groups(tree.b)];
}
export function normalize(
  value: any,
  seen = new Set<DockId>(),
  depth = 0,
  nodes = new Set<string>(),
): DockTree | null {
  if (!value || depth > 30 || typeof value !== "object") return null;
  const id =
    typeof value.id === "string" && !nodes.has(value.id) ? value.id : uid();
  nodes.add(id);
  if (value.kind === "split") {
    const a = normalize(value.a, seen, depth + 1, nodes),
      b = normalize(value.b, seen, depth + 1, nodes);
    return a && b
      ? {
          kind: "split",
          id,
          axis: value.axis === "y" ? "y" : "x",
          ratio: Math.max(0.1, Math.min(0.9, Number(value.ratio) || 0.5)),
          a,
          b,
        }
      : a || b;
  }
  const tabs = (Array.isArray(value.tabs) ? value.tabs : []).filter(
    (tab: DockId) => {
      if (!validIds.includes(tab) || seen.has(tab)) return false;
      seen.add(tab);
      return true;
    },
  );
  return tabs.length
    ? {
        kind: "group",
        id,
        tabs,
        active: tabs.includes(value.active) ? value.active : tabs[0],
      }
    : null;
}
export function remove(tree: DockTree | null, id: DockId): DockTree | null {
  if (!tree) return null;
  if (tree.kind === "group") {
    const tabs = tree.tabs.filter((value) => value !== id);
    return tabs.length
      ? {
          ...tree,
          tabs,
          active: tabs.includes(tree.active) ? tree.active : tabs[0],
        }
      : null;
  }
  const a = remove(tree.a, id),
    b = remove(tree.b, id);
  return a && b ? { ...tree, a, b } : a || b;
}
export function updateGroup(
  tree: DockTree,
  id: string,
  fn: (group: Group) => DockTree,
): DockTree {
  if (tree.kind === "group") return tree.id === id ? fn(tree) : tree;
  return {
    ...tree,
    a: updateGroup(tree.a, id, fn),
    b: updateGroup(tree.b, id, fn),
  };
}
export function location(
  tree: DockTree | null,
  id: DockId,
): { target: DockId; edge: Edge; ratio?: number } | undefined {
  if (!tree) return undefined;
  if (tree.kind === "group") {
    const target = tree.tabs.find((tab) => tab !== id);
    return target ? { target, edge: "center" } : undefined;
  }
  const a = ids(tree.a).includes(id),
    own = a ? tree.a : tree.b;
  const nested = location(own, id);
  if (nested) return nested;
  const other = ids(a ? tree.b : tree.a)[0];
  return other
    ? {
        target: other,
        ratio: tree.ratio,
        edge: tree.axis === "x" ? (a ? "left" : "right") : a ? "top" : "bottom",
      }
    : undefined;
}
export function dock(
  tree: DockTree | null,
  tab: DockId,
  targetId?: string,
  edge: Edge = "center",
  splitRatio = 0.5,
): DockTree {
  if (!tree) return group([tab]);
  const original =
    groups(tree).find((value) => value.id === targetId) || groups(tree)[0];
  if (original.tabs.length === 1 && original.tabs[0] === tab) return tree;
  const without = remove(tree, tab);
  if (!without) return group([tab]);
  // A group's stable identity survives removal of one of its own tabs.
  const target =
    groups(without).find((value) => value.id === original.id) ||
    groups(without)[0];
  return updateGroup(without, target.id, (value) =>
    edge === "center"
      ? { ...value, tabs: [...value.tabs, tab], active: tab }
      : {
          kind: "split",
          id: uid(),
          axis: edge === "left" || edge === "right" ? "x" : "y",
          ratio: Math.max(0.1, Math.min(0.9, splitRatio)),
          a: edge === "left" || edge === "top" ? group([tab]) : value,
          b: edge === "left" || edge === "top" ? value : group([tab]),
        },
  );
}
export function ratio(tree: DockTree, id: string, value: number): DockTree {
  if (tree.kind === "group") return tree;
  return tree.id === id
    ? { ...tree, ratio: Math.max(0.1, Math.min(0.9, value)) }
    : { ...tree, a: ratio(tree.a, id, value), b: ratio(tree.b, id, value) };
}
export function minimum(tree: DockTree | null): {
  width: number;
  height: number;
} {
  if (!tree || tree.kind === "group")
    return { width: tree?.tabs.includes("files") ? 420 : 280, height: 180 };
  const a = minimum(tree.a),
    b = minimum(tree.b);
  return tree.axis === "x"
    ? { width: a.width + b.width + 5, height: Math.max(a.height, b.height) }
    : { width: Math.max(a.width, b.width), height: a.height + b.height + 5 };
}
export function geometry(
  tree: DockTree | null,
  bounds: Rect,
): {
  groups: { group: Group; rect: Rect }[];
  splits: { id: string; axis: "x" | "y"; rect: Rect; parent: Rect }[];
} {
  const output: ReturnType<typeof geometry> = { groups: [], splits: [] };
  function walk(node: DockTree, r: Rect) {
    if (node.kind === "group") {
      output.groups.push({ group: node, rect: r });
      return;
    }
    const horizontal = node.axis === "x",
      length = (horizontal ? r.width : r.height) - 5;
    const am = minimum(node.a),
      bm = minimum(node.b);
    const first = Math.max(
      horizontal ? am.width : am.height,
      Math.min(
        length - (horizontal ? bm.width : bm.height),
        length * node.ratio,
      ),
    );
    const a = { ...r, [horizontal ? "width" : "height"]: first },
      b = {
        ...r,
        [horizontal ? "x" : "y"]: (horizontal ? r.x : r.y) + first + 5,
        [horizontal ? "width" : "height"]: length - first,
      };
    output.splits.push({
      id: node.id,
      axis: node.axis,
      parent: r,
      rect: {
        ...r,
        [horizontal ? "x" : "y"]: (horizontal ? r.x : r.y) + first,
        [horizontal ? "width" : "height"]: 5,
      },
    });
    walk(node.a, a);
    walk(node.b, b);
  }
  if (tree) walk(tree, bounds);
  return output;
}
