/**
 * The office roster at runtime.
 *
 * `/api/config` is the single source of truth: title, timezone, teams and the
 * list of desks. The static table in agents.ts is only the seed — it supplies
 * the hand-placed desks and the look of the eleven original agents, so an
 * existing office renders exactly as before. A profile the seed does not know
 * gets a deterministic look (hashed from its id, drawn from the same palette)
 * and the nearest free desk on the 4.5 x 4.0 lattice.
 */
import { AGENTS, TEAMS, type AgentMeta, type HairStyle, type Look } from './agents'
import {
  DEFAULT_GRID,
  TEAM_CENTRE,
  deskObstacle,
  planDesks,
  type DeskSpot,
  type Edge,
  type GridSpec,
  type Obstacle,
} from './layout'

/** One desk as `/api/config` publishes it. */
export interface RosterEntry {
  id: string
  name: string
  role: string
  team: string
}

export interface ConfigTeam {
  id: string
  label: string
}

/** GET /api/config, exactly as the Go side emits it. */
export interface OfficeConfig {
  title: string
  tz: string
  source: string
  hermes_home?: string
  remote_api_url?: string
  profiles: string[]
  roster: RosterEntry[]
  layout: { floor: { w: number; d: number }; grid?: { dx: number; dz: number }; aisle?: number }
  teams: ConfigTeam[]
}

export interface TeamMeta {
  id: string
  /** short, upper-case label used in the rails ("TIM DEV") */
  label: string
  /** display name ("Tim Dev") */
  name: string
  sub: string
  accent: string
}

const DEFAULT_TITLE = 'Agent Office'
const DEFAULT_TZ = 'Asia/Jakarta'
const DEFAULT_FLOOR = { w: 40, d: 30 }
const WALL_T = 0.22
const WALKER = 0.35

// ------------------------------------------------------------------ palettes

const unique = (xs: string[]): string[] => [...new Set(xs)]

/** The palette is the one the hand-drawn agents already use. */
const PALETTE = {
  skin: unique(AGENTS.map((a) => a.look.skin)),
  hair: unique(AGENTS.map((a) => a.look.hair)),
  shirt: unique(AGENTS.map((a) => a.look.shirt)),
  pants: unique(AGENTS.map((a) => a.look.pants)),
  accent: unique(AGENTS.map((a) => a.look.accent)),
  hijab: unique(AGENTS.filter((a) => a.look.hijab).map((a) => a.look.hijab!)),
}

const STYLES: HairStyle[] = ['crop', 'short', 'side', 'long', 'bun', 'curly', 'messy']

/** FNV-1a, 32 bit. Same id always gives the same face. */
export function hashId(id: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function pick<T>(arr: T[], h: number, shift: number): T {
  return arr[(h >>> shift) % arr.length]!
}

/** A stable look for an id the seed does not describe. */
export function lookFor(id: string): Look {
  const h = hashId(id)
  const female = ((h >>> 11) & 1) === 1
  const look: Look = {
    skin: pick(PALETTE.skin, h, 0),
    hair: pick(PALETTE.hair, h, 5),
    style: pick(STYLES, h, 9),
    shirt: pick(PALETTE.shirt, h, 13),
    pants: pick(PALETTE.pants, h, 17),
    accent: pick(PALETTE.accent, h, 21),
    build: 0.9 + ((h >>> 3) % 5) * 0.05,
    tall: 0.96 + ((h >>> 7) % 5) * 0.02,
  }
  if (female) {
    look.female = true
    if (((h >>> 14) & 1) === 1) look.hijab = pick(PALETTE.hijab.length ? PALETTE.hijab : PALETTE.shirt, h, 23)
    if (((h >>> 15) & 1) === 1) look.skirt = true
  }
  if (((h >>> 12) & 1) === 1) look.glasses = true
  if (!female && ((h >>> 16) & 1) === 1) look.stubble = true
  return look
}

// ------------------------------------------------------------------- registry

interface Registry {
  title: string
  tz: string
  agents: AgentMeta[]
  byId: Map<string, AgentMeta>
  teams: TeamMeta[]
  teamById: Map<string, TeamMeta>
  floor: { w: number; d: number }
  grid: GridSpec
  /** true once /api/config has been applied */
  live: boolean
}

function seedTeamMeta(id: string): TeamMeta {
  const known = TEAMS[id as keyof typeof TEAMS]
  if (known) {
    return {
      id,
      label: known.label,
      name: known.name,
      sub: known.sub,
      accent: known.accent,
    }
  }
  return { id, label: id.toUpperCase(), name: id, sub: id, accent: '#93a1ae' }
}

function seedRegistry(): Registry {
  const agents = AGENTS.map((a) => ({ ...a, look: { ...a.look }, desk: { ...a.desk } }))
  return {
    title: DEFAULT_TITLE,
    tz: DEFAULT_TZ,
    agents,
    byId: new Map(agents.map((a) => [a.id, a])),
    teams: Object.keys(TEAMS).map(seedTeamMeta),
    teamById: new Map(Object.keys(TEAMS).map((id) => [id, seedTeamMeta(id)])),
    floor: { ...DEFAULT_FLOOR },
    grid: { ...DEFAULT_GRID },
    live: false,
  }
}

let reg: Registry = seedRegistry()

export function officeTitle(): string {
  return reg.title
}

export function officeTZ(): string {
  return reg.tz
}

/** "WIB" for Jakarta (the office has always said WIB), else the city name. */
export function tzLabel(): string {
  if (reg.tz === 'Asia/Jakarta') return 'WIB'
  const parts = reg.tz.split('/')
  return (parts[parts.length - 1] ?? reg.tz).replace(/_/g, ' ')
}

export function rosterAgents(): AgentMeta[] {
  return reg.agents
}

export function teamIds(): string[] {
  return reg.teams.map((t) => t.id)
}

export function teamMeta(id: string): TeamMeta {
  const found = reg.teamById.get(id)
  if (found) return found
  const meta = seedTeamMeta(id)
  reg.teamById.set(id, meta)
  reg.teams.push(meta)
  return meta
}

export function agentMeta(id: string): AgentMeta {
  const found = reg.byId.get(id)
  if (found) return found
  return ensureAgent(id, reg.agents.length)
}

/** Deep links accept either the profile id or the display name. */
export function resolveAgentId(token: string): string | null {
  const t = token.trim().toLowerCase()
  if (!t) return null
  if (reg.byId.has(t)) return t
  const byName = reg.agents.find((a) => a.name.toLowerCase() === t)
  return byName ? byName.id : null
}

function obstaclesNow(): Obstacle[] {
  return [...wallObstacles(), ...reg.agents.map((a) => deskObstacle(a.desk, a.id))]
}

/** Walls are footprints too: a desk may not sit inside the partition. */
function wallObstacles(): Obstacle[] {
  // Imported lazily from rooms.ts to keep this module free of scene imports at
  // module-eval time; the values are static.
  const walls = WALL_SEGMENTS
  const t = WALL_T / 2
  return walls.map((w, i) =>
    w.axis === 'x'
      ? { id: `wall-x${i}`, x1: Math.min(w.from, w.to), z1: w.at - t, x2: Math.max(w.from, w.to), z2: w.at + t }
      : { id: `wall-z${i}`, x1: w.at - t, z1: Math.min(w.from, w.to), x2: w.at + t, z2: Math.max(w.from, w.to) },
  )
}

// Filled in by rooms.ts on import (see setWalls) to avoid an import cycle.
interface WallSegLike {
  axis: 'x' | 'z'
  at: number
  from: number
  to: number
}
let WALL_SEGMENTS: WallSegLike[] = []
let NAV_EDGES_RESOLVED: Edge[] = []

/** rooms.ts calls this once at module load. */
export function setFloorContext(walls: WallSegLike[], edges: Edge[]): void {
  WALL_SEGMENTS = walls
  NAV_EDGES_RESOLVED = edges
}

/** Accept the legacy room name so an older API still lands in the right room. */
export function normalizeTeam(team: string | undefined): string {
  const t = (team ?? '').trim()
  if (!t) return ''
  return t.toLowerCase() === 'pendopo' ? 'lobby' : t
}

function guessTeam(id: string): string {
  const low = id.toLowerCase()
  if (low === 'default' || low === 'lobby' || low === 'pendopo') return 'lobby'
  if (low === 'edu' || low.startsWith('edu-')) return 'edu'
  return 'dev'
}

/** Add a desk for an id the config did not list (status-only agent). */
function ensureAgent(id: string, _index: number): AgentMeta {
  const team = guessTeam(id)
  const [spot] = planDesks({
    team,
    ids: [id],
    anchors: reg.agents.filter((a) => a.team === team).map((a) => a.desk),
    obstacles: obstaclesNow(),
    edges: NAV_EDGES_RESOLVED,
    floor: reg.floor,
    grid: reg.grid,
    wallT: WALL_T,
    walker: WALKER,
  })
  const desk: DeskSpot = spot ?? { id, x: TEAM_CENTRE[team]?.[0] ?? 0, z: TEAM_CENTRE[team]?.[1] ?? 0, rot: Math.PI }
  const meta: AgentMeta = {
    id,
    name: id,
    role: 'AGEN',
    team: team as AgentMeta['team'],
    desc: 'Profil Hermes tanpa desk khusus.',
    look: lookFor(id),
    desk,
  }
  reg.agents.push(meta)
  reg.byId.set(id, meta)
  teamMeta(team)
  return meta
}

/** Apply GET /api/config. Unknown ids are placed on the lattice, in id order. */
export function applyConfig(cfg: OfficeConfig | null): void {
  if (!cfg) return
  const next = seedRegistry()
  next.live = true
  next.title = cfg.title?.trim() || DEFAULT_TITLE
  next.tz = cfg.tz?.trim() || DEFAULT_TZ
  next.floor = {
    w: Number(cfg.layout?.floor?.w) || DEFAULT_FLOOR.w,
    d: Number(cfg.layout?.floor?.d) || DEFAULT_FLOOR.d,
  }
  next.grid = {
    dx: Number(cfg.layout?.grid?.dx) || DEFAULT_GRID.dx,
    dz: Number(cfg.layout?.grid?.dz) || DEFAULT_GRID.dz,
    aisle: Number(cfg.layout?.aisle) || DEFAULT_GRID.aisle,
  }

  const entries: RosterEntry[] = cfg.roster?.length
    ? cfg.roster
    : (cfg.profiles ?? []).map((id) => ({ id, name: id, role: 'AGEN', team: guessTeam(id) }))

  // Keep the hand-placed desks of every seed agent, and plan the rest.
  const known = new Map(AGENTS.map((a) => [a.id, a]))
  const metas: AgentMeta[] = []
  const pending: RosterEntry[] = []
  const used = new Set<string>()

  for (const e of entries) {
    if (!e.id || used.has(e.id)) continue
    used.add(e.id)
    const base = known.get(e.id)
    if (!base) {
      pending.push(e)
      continue
    }
    metas.push({
      ...base,
      name: e.name?.trim() || base.name,
      role: e.role?.trim() || base.role,
      team: (normalizeTeam(e.team) || base.team) as AgentMeta['team'],
      look: { ...base.look },
      desk: { ...base.desk },
    })
  }

  // A new agent joins its team's lattice; planning order is the roster order,
  // so the same config always produces the same office.
  const obstacles: Obstacle[] = [
    ...wallObstacles(),
    ...metas.map((m) => deskObstacle(m.desk, m.id)),
    ...EXTRA_FURNITURE,
  ]
  const groups = new Map<string, RosterEntry[]>()
  for (const e of pending) {
    const team = normalizeTeam(e.team) || guessTeam(e.id)
    if (!groups.has(team)) groups.set(team, [])
    groups.get(team)!.push({ ...e, team })
  }
  for (const [team, list] of groups) {
    const anchors = metas.filter((m) => m.team === team).map((m) => m.desk)
    const spots = planDesks({
      team,
      ids: list.map((e) => e.id),
      anchors,
      obstacles,
      edges: NAV_EDGES_RESOLVED,
      floor: next.floor,
      grid: next.grid,
      wallT: WALL_T,
      walker: WALKER,
    })
    list.forEach((e, i) => {
      const desk: DeskSpot = spots[i] ?? { id: e.id, x: 0, z: 0, rot: Math.PI }
      obstacles.push(deskObstacle(desk, e.id))
      metas.push({
        id: e.id,
        name: e.name?.trim() || e.id,
        role: e.role?.trim() || 'AGEN',
        team: team as AgentMeta['team'],
        desc: 'Profil Hermes tanpa desk khusus.',
        look: lookFor(e.id),
        desk,
      })
    })
  }

  next.agents = metas
  next.byId = new Map(metas.map((m) => [m.id, m]))
  next.teams = []
  next.teamById = new Map()
  const labels = new Map((cfg.teams ?? []).map((t) => [normalizeTeam(t.id) || t.id, t.label]))
  for (const id of Object.keys(TEAMS)) {
    next.teamById.set(id, seedTeamMeta(id))
  }
  for (const m of metas) {
    if (next.teamById.has(m.team)) continue
    const meta = seedTeamMeta(m.team)
    const label = labels.get(m.team)
    if (label) {
      meta.label = label.toUpperCase()
      meta.name = label
    }
    next.teamById.set(m.team, meta)
  }
  // Stable order: the three rooms first, then anything custom, alphabetical.
  const builtin = Object.keys(TEAMS)
  next.teams = [
    ...builtin.filter((id) => next.teamById.has(id)).map((id) => next.teamById.get(id)!),
    ...[...next.teamById.keys()].filter((id) => !builtin.includes(id)).sort().map((id) => next.teamById.get(id)!),
  ]

  reg = next
}

/** Furniture footprints that are not desks (mirrors lib/rooms.ts OBSTACLES). */
let EXTRA_FURNITURE: Obstacle[] = []

/** rooms.ts calls this once at module load with its static furniture list. */
export function setFurniture(list: Obstacle[]): void {
  EXTRA_FURNITURE = list
}

/** Ensure every id in `ids` has a desk, then return the full roster. */
export function agentsFor(ids: string[]): AgentMeta[] {
  const extra: string[] = []
  for (const id of ids) {
    if (id && !reg.byId.has(id)) extra.push(id)
  }
  // Deterministic: status-only agents join in id order.
  for (const id of [...new Set(extra)].sort()) ensureAgent(id, reg.agents.length)
  return reg.agents
}

// ---------------------------------------------------------------- /api/config

const CONFIG_TIMEOUT_MS = 2500

function isConfig(v: unknown): v is OfficeConfig {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return typeof o.title === 'string' && typeof o.tz === 'string' && Array.isArray(o.roster)
}

/** Fetch /api/config once at boot. Any failure falls back to the seed roster. */
export async function loadConfig(): Promise<OfficeConfig | null> {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = setTimeout(() => ctrl?.abort(), CONFIG_TIMEOUT_MS)
  try {
    const res = await fetch('/api/config', {
      signal: ctrl?.signal,
      headers: { accept: 'application/json' },
      cache: 'no-store',
    })
    if (!res.ok) return null
    const json: unknown = await res.json()
    return isConfig(json) ? json : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The bundled roster as an OfficeConfig. Used when /api/config cannot be
 * reached at all: the office must still render the eleven seeded desks
 * instead of an empty room (an API outage is not an empty office).
 */
export function seedConfig(): OfficeConfig {
  return {
    title: DEFAULT_TITLE,
    tz: DEFAULT_TZ,
    source: 'seed',
    profiles: AGENTS.map((a) => a.id),
    roster: AGENTS.map((a) => ({ id: a.id, name: a.name, role: a.role, team: a.team })),
    layout: { floor: { ...DEFAULT_FLOOR } },
    teams: (Object.keys(TEAMS) as Array<keyof typeof TEAMS>).map((id) => ({ id, label: TEAMS[id].label })),
  }
}

/** Boot: apply the config, or the seed when the API is unreachable. */
export async function bootOffice(): Promise<void> {
  const cfg = await loadConfig()
  applyConfig(cfg ?? seedConfig())
  if (!cfg && typeof console !== 'undefined') {
    console.warn('[office] /api/config unreachable — rendering the bundled seed roster')
  }
  if (typeof document !== 'undefined') {
    document.title = officeTitle()
  }
}
