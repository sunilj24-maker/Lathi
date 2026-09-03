import type { ProfileId } from "@/data/config";
import type { RoutingGraph } from "@/lib/types";
import { edgeCost } from "./profiles";

export type RouteResult =
  | {
      ok: true;
      nodeIds: string[];
      cost: number;
      lengthM: number;
      rampsUsed: number;
      stairsUsed: number;
    }
  | { ok: false; reason: "no-route" };

type AdjEdge = {
  to: string;
  lengthM: number;
  tags: Record<string, string>;
};

export function dijkstra(
  graph: RoutingGraph,
  start: string,
  goal: string,
  profile: ProfileId,
): RouteResult {
  if (!graph.nodes[start] || !graph.nodes[goal]) {
    return { ok: false, reason: "no-route" };
  }
  if (start === goal) {
    return {
      ok: true,
      nodeIds: [start],
      cost: 0,
      lengthM: 0,
      rampsUsed: 0,
      stairsUsed: 0,
    };
  }

  const adj = new Map<string, AdjEdge[]>();
  for (const e of graph.edges) {
    const a = adj.get(e.from) ?? [];
    a.push({ to: e.to, lengthM: e.lengthM, tags: e.tags });
    adj.set(e.from, a);
    const b = adj.get(e.to) ?? [];
    b.push({ to: e.from, lengthM: e.lengthM, tags: e.tags });
    adj.set(e.to, b);
  }

  const dist = new Map<string, number>();
  const prev = new Map<string, { from: string; lengthM: number; usedRamp: boolean; usedSteps: boolean }>();
  const heap: { id: string; d: number }[] = [];

  const push = (id: string, d: number) => {
    heap.push({ id, d });
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p].d <= heap[i].d) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };

  const pop = () => {
    if (!heap.length) return undefined;
    const top = heap[0];
    const last = heap.pop()!;
    if (!heap.length) return top;
    heap[0] = last;
    let i = 0;
    while (true) {
      const l = i * 2 + 1;
      const r = l + 1;
      let smallest = i;
      if (l < heap.length && heap[l].d < heap[smallest].d) smallest = l;
      if (r < heap.length && heap[r].d < heap[smallest].d) smallest = r;
      if (smallest === i) break;
      [heap[i], heap[smallest]] = [heap[smallest], heap[i]];
      i = smallest;
    }
    return top;
  };

  dist.set(start, 0);
  push(start, 0);

  while (heap.length) {
    const cur = pop()!;
    const best = dist.get(cur.id);
    if (best == null || cur.d !== best) continue;
    if (cur.id === goal) break;

    for (const edge of adj.get(cur.id) ?? []) {
      const nodeTags = graph.nodes[edge.to]?.tags;
      const priced = edgeCost(edge.lengthM, edge.tags, nodeTags, profile);
      if (priced.kind === "forbidden") continue;
      const nd = cur.d + priced.cost;
      const prevBest = dist.get(edge.to);
      if (prevBest == null || nd < prevBest) {
        dist.set(edge.to, nd);
        prev.set(edge.to, {
          from: cur.id,
          lengthM: edge.lengthM,
          usedRamp: priced.usedRamp,
          usedSteps: priced.usedSteps,
        });
        push(edge.to, nd);
      }
    }
  }

  if (!dist.has(goal)) return { ok: false, reason: "no-route" };

  const nodeIds: string[] = [];
  let rampsUsed = 0;
  let stairsUsed = 0;
  let lengthM = 0;
  let walk: string | undefined = goal;
  while (walk) {
    nodeIds.push(walk);
    const step = prev.get(walk);
    if (!step) break;
    lengthM += step.lengthM;
    if (step.usedRamp) rampsUsed += 1;
    if (step.usedSteps) stairsUsed += 1;
    walk = step.from;
    if (walk === start) {
      nodeIds.push(start);
      break;
    }
  }
  nodeIds.reverse();

  return {
    ok: true,
    nodeIds,
    cost: dist.get(goal)!,
    lengthM,
    rampsUsed,
    stairsUsed,
  };
}
