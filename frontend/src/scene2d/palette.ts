/**
 * The 2D office colour palette — transcribes docs/design/office-2d.md §2.
 *
 * Terracotta + navy high-contrast, 2–3 tones per family, status colours shared
 * with the panel chrome so a dot on the canvas is the same colour as a dot in
 * the sidebar. No gradients, no blur: a shadow is the next solid tone down.
 */
export const PALETTE = {
  // navy — walls, surfaces, plates, lines (design §2.1)
  navy900: '#101828',
  navy800: '#182238',
  navy700: '#24304A',
  navy600: '#33415F',
  // terracotta — the one warm accent (Pendopo floor, active buttons, furniture)
  terra600: '#8F4520',
  terra500: '#C4602C',
  terra400: '#E07B3E',
  terra300: '#F0A268',
  // sand / wood — desk tops, floor edges, speech bubbles
  sand500: '#C2A176',
  sand400: '#D9B98C',
  sand300: '#E8CFA8',
  sand200: '#F2E2C4',
  // text on navy
  ink: '#F4E9D6',
  inkDim: '#C9CFDD',
  muted: '#93A0BC',
  line: '#33415F',
} as const

/** Agent status colours (design §2.2) — identical on canvas and panels. */
export const STATUS = {
  working: '#F2B434',
  reviewing: '#A98CE0',
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
  bubbleInk: '#241812',
} as const

/** Team accents (design §2.7) — kept from the existing TEAMS data. */
export const TEAM = {
  lobby: '#D4805C',
  dev: '#82AAC8',
  edu: '#DEB860',
} as const

/**
 * Zone floor motifs (design §3.1). Three visually distinct floors: Pendopo
 * terracotta checker, Tim Dev navy plank with a seam, Tim Edu woven bamboo.
 */
export const ZONE_FLOOR = {
  lobby: { a: '#C4602C', b: '#E07B3E', edge: '#E8CFA8' },
  dev: { plank: '#1F2A42', seam: '#16203A', duct: '#C99A3C' },
  edu: { bamboo: '#D9B36B', line: '#C49A4E', mat: '#E8CFA8' },
} as const

/** Misc canvas colours the design mentions outside the main families. */
export const EXTRAS = {
  /** the page behind the canvas ("lukisan malam") */
  bg: '#0B1120',
  /** dark text on terracotta / blocked chip (12.1:1) */
  inkOnTerra: '#1A1208',
  /** stale-data banner */
  staleBg: '#5A3A1A',
  staleText: '#FFD9A8',
  /** plant greens */
  plantDark: '#4E7A55',
  plantLight: '#6FA878',
  /** the orange cat */
  cat: '#D9863A',
} as const
