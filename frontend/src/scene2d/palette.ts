/**
 * The 2D office colour palette — transcribes docs/design/office-3-floors.md §2.
 *
 * Modern office building: a cool grey-blue concrete ramp carries walls, floors
 * and plates; glass panes are 2–3 solid blue tones (never a real alpha
 * gradient); steel paints the lift, legs and frames; warm-white ceiling lights
 * are the one bright note; a single amber accent marks active states. Status
 * colours are shared with the panel chrome so a dot on the canvas is the same
 * colour as a dot in the sidebar. No gradients, no blur: a shadow is the next
 * solid tone down.
 */
export const PALETTE = {
  // concrete — cool grey-blue ramp: walls, floor surfaces, plates, lines
  concrete100: '#E4EAF0', // white concrete: desk tops, reception counter
  concrete200: '#C7D2DE', // light concrete: desk front panels, L2 floor
  concrete500: '#3B4A5E', // mid concrete: trim, plinth edges
  concrete600: '#2E3B4D', // wall band body, plinth
  concrete700: '#24303F', // hollow fills, plate borders
  concrete800: '#1A2330', // plate bodies, panel backgrounds
  concrete900: '#121924', // deepest surface: page-adjacent walls, offline plates
  // glass — blue panes in solid tones (partition walls, meeting table tops)
  glass300: '#7FA3C0', // pane highlight, mullion glint
  glass500: '#456E8F', // the pane itself
  glass700: '#2C4A66', // pane shadow tone
  // steel — the lift shaft, door panels, legs, frames, server rack
  steel300: '#7E8B99', // steel highlight edge
  steel500: '#525F6D', // steel body
  steel700: '#39434F', // steel shadow, chair graphite
  // ceiling light — warm white strips and pools
  lamp: '#F2E7C4',
  // foliage — the only living green in the room: plants and planters. Two
  // tones so a leaf mass reads as a silhouette instead of a flat blob.
  foliage: '#5E7F63',
  foliageDark: '#41583F',
  foliageLight: '#7EA184',
  // the one warm accent — active states, lift call, blocked-adjacent warmth
  amber: '#E8A33D',
  amberDeep: '#9A6A1E', // accent border/shadow tone
  // text on dark surfaces
  ink: '#EDF1F6',
  inkDim: '#C3CDD9',
  muted: '#8A97A9',
  line: '#2E3B4D',
} as const

/** Agent status colours (design §2.2) — identical on canvas and panels. */
export const STATUS = {
  working: '#F2B434',
  reviewing: '#A98CE0',
  waiting: '#FFA94D',
  idle: '#6FB1E8',
  blocked: '#FFC93B',
  offline: '#8B93A5',
  ok: '#7FC08C',
  danger: '#E2705F',
} as const

/** Monitor screens & in-world details (design §2.3). */
export const SCREEN = {
  bg: '#14201A',
  green: '#9CE8A8',
  blue: '#8FB8E8',
  paper: '#EFE4CC',
  bubbleInk: '#1A2027',
} as const

/**
 * Team identity accents (design §2.7) — kept from the existing TEAMS data so
 * a desk border, a roster bar and a floor tab always agree. They are identity
 * colours, not floor colours: dev = cool blue, edu = warm amber-yellow,
 * lobby = neutral warm terracotta-tan (the only surviving warm note besides
 * the amber accent).
 */
export const TEAM = {
  lobby: '#D4805C',
  dev: '#82AAC8',
  edu: '#DEB860',
} as const

/**
 * Per-floor slab & motif tones (design §3.1). L1 polished concrete with
 * terrazzo flecks + entry mat; L2 light concrete with a soft zone rug under
 * the edu block + glass wall band; L3 dark polished concrete with a steel
 * cable tray and warm ceiling-light strips.
 */
export const FLOOR_MOTIF = {
  lobby: {
    slab: '#39434F',
    fleck: '#4A5665',
    fleckLight: '#5C6A7B',
    mat: '#2A313B', // entry mat at the MASUK door
    matEdge: '#525F6D',
  },
  edu: {
    slab: '#C7D2DE',
    seam: '#B4C0CD',
    rug: '#8E99AC', // soft zone rug under the 2×2 edu block
    rugEdge: '#77839A',
    band: '#456E8F', // glass wall band along the north wall
  },
  dev: {
    slab: '#232C38',
    seam: '#1B222D',
    tray: '#39434F', // steel cable tray
    lamp: '#F2E7C4', // ceiling-light strip core
  },
} as const

/** Misc canvas colours the design mentions outside the main families. */
export const EXTRAS = {
  /** the page behind the canvas */
  bg: '#0A0F16',
  /** dark text on the amber accent / blocked chip */
  inkOnAmber: '#191104',
  /** stale-data banner */
  staleBg: '#4A3A16',
  staleText: '#FFE1A8',
} as const

// ------------------------------------------------------------ two themes
/**
 * Canvas tokens for the two first-class themes (design §2.3). Day is
 * Daylight Atrium (06:00–18:00 in the office timezone), night is Sky Lobby.
 * The city palettes live here too: the skyline is part of the room, not a
 * decoration on top of it.
 */
export type ThemeName = 'day' | 'night'

export const THEME_TOKENS = {
  day: {
    glass: {
      surface: '#FFFFFF',
      alpha: 0.66,
      border: '#0F2440',
      borderAlpha: 0.2,
      highlight: '#FFFFFF',
      highlightAlpha: 0.85,
    },
    city: {
      skyTop: '#3E8FD6',
      skyMid: '#7CBCEC',
      skyLow: '#C4E1F6',
      horizon: '#F0F9FF',
      layers: ['#A9C6DD', '#8FB0CC', '#7699B8', '#5E82A3'],
      windowWarm: '#EAF7FF',
      windowCool: '#BFE2F7',
    },
    page: '#EEF3F8',
    floor: '#E3EAF2',
    wall: '#DDE6F0',
    surface: '#FFFFFF',
    surfaceSolid: '#F7FAFD',
    surfaceRaised: '#FFFFFF',
    desk: '#FFFFFF',
    deskTop: '#F2F6FA',
    ink: '#16202E',
    inkDim: '#41506A',
    muted: '#556377',
    accent: '#1D4ED8',
    accentDeep: '#1D4ED8',
    accentInk: '#FFFFFF',
    lamp: '#FFF6DC',
    plant: '#3F7A52',
    plantDark: '#2C5A3B',
    shadowAlpha: 0.17,
  },
  night: {
    glass: {
      surface: '#141B2E',
      alpha: 0.62,
      border: '#FFFFFF',
      borderAlpha: 0.16,
      highlight: '#FFFFFF',
      highlightAlpha: 0.3,
    },
    city: {
      skyTop: '#0C1222',
      skyMid: '#2B3350',
      skyLow: '#8A5560',
      horizon: '#E0A06A',
      layers: ['#0E1626', '#16203A', '#1D2A47', '#26344F'],
      windowWarm: '#F3C57B',
      windowCool: '#9FD8E8',
    },
    page: '#080C16',
    floor: '#1A2230',
    wall: '#121A29',
    surface: '#141B2E',
    surfaceSolid: '#141B2E',
    surfaceRaised: '#1B2334',
    desk: '#243044',
    deskTop: '#39485F',
    ink: '#F2F5FA',
    inkDim: '#C6D0E0',
    muted: '#93A0B6',
    accent: '#F0B45A',
    accentDeep: '#A9741F',
    accentInk: '#1A1206',
    lamp: '#F2E7C4',
    plant: '#5E7F63',
    plantDark: '#41583F',
    shadowAlpha: 0.27,
  },
} as const

/**
 * Status colours per theme. The day values are the darkened ones that passed
 * the 4.5:1 text threshold (design §3.3) — do not lighten them again without
 * re-running `verify/theme_check.ts`.
 */
export const THEME_STATUS = {
  day: {
    working: '#8A5406',
    reviewing: '#6D28D9',
    waiting: '#9A3412',
    idle: '#1D4ED8',
    blocked: '#B33A12',
    offline: '#556073',
    ok: '#116B33',
    danger: '#B91C1C',
  },
  night: {
    working: '#F2B434',
    reviewing: '#A98CE0',
    waiting: '#FFA94D',
    idle: '#6FB1E8',
    blocked: '#FFC93B',
    offline: '#8B93A5',
    ok: '#7FC08C',
    danger: '#E2705F',
  },
} as const

/** The full canvas palette of one theme. */
export function paletteFor(theme: ThemeName) {
  const t = THEME_TOKENS[theme]
  return {
    ...t,
    status: THEME_STATUS[theme],
    team: TEAM,
  }
}

/** Text ink that stays readable on a status chip filled with a status colour. */
export function inkOnStatus(theme: ThemeName): string {
  return theme === 'day' ? '#FFFFFF' : '#11160E'
}
