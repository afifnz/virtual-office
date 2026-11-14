/** Shortest path over the office waypoint graph (Dijkstra, tiny graph). */
import { NAV, NAV_EDGES, type NavNode } from './rooms'

const ADJ = new Map<string, Array<{ id: string; w: number }>>()
const BY_ID = new Map<string, NavNode>(NAV.map((n) => [n.id, n]))

for (const [a, b] of NAV_EDGES) {
  const na = BY_ID.get(a)
  const nb = BY_ID.get(b)
  if (!na || !nb) continue
  const w = Math.hypot(na.x - nb.x, na.z - nb.z)
  if (!ADJ.has(a)) ADJ.set(a, [])
  if (!ADJ.has(b)) ADJ.set(b, [])
  ADJ.get(a)!.push({ id: b, w })
  ADJ.get(b)!.push({ id: a, w })
}

export type Pt = [number, number]

/** Returns waypoints (x,z) from `from` to `to`, both as nav-node ids. */
export function navPath(fromId: string, toId: string): Pt[] {
  if (fromId === toId) return []
  const dist = new Map<string, number>()
  const prev = new Map<string, string>()
  const seen = new Set<string>()
  dist.set(fromId, 0)

  while (true) {
    let cur: string | null = null
    let curD = Infinity
    for (const [id, d] of dist) {
      if (!seen.has(id) && d < curD) {
        cur = id
        curD = d
      }
    }
    if (cur === null) break
    if (cur === toId) break
    seen.add(cur)
    for (const e of ADJ.get(cur) ?? []) {
      const nd = curD + e.w
      if (nd < (dist.get(e.id) ?? Infinity)) {
        dist.set(e.id, nd)
        prev.set(e.id, cur)
      }
    }
  }
  if (!dist.has(toId)) return []

  const ids: string[] = []
  let cur: string | undefined = toId
  while (cur && cur !== fromId) {
    ids.push(cur)
    cur = prev.get(cur)
  }
  ids.reverse()
  return ids.map((id) => {
    const n = BY_ID.get(id)!
    return [n.x, n.z] as Pt
  })
}

/** Total walking distance of a path. */
export function pathLength(path: Pt[]): number {
  let d = 0
  let prev: Pt | null = null
  for (const p of path) {
    if (prev) d += Math.hypot(p[0] - prev[0], p[1] - prev[1])
    prev = p
  }
  return d
}
