import type { TeamId } from './types'

export type HairStyle = 'crop' | 'short' | 'side' | 'long' | 'bun' | 'curly' | 'messy'

/** Visual description of one agent. Everything is data: the scene renders it. */
export interface Look {
  skin: string
  hair: string
  style: HairStyle
  shirt: string
  pants: string
  accent: string
  hijab?: string
  skirt?: boolean
  glasses?: boolean
  headphones?: string
  longSleeve?: boolean
  peci?: boolean
  mustache?: boolean
  stubble?: boolean
  build: number // 0.88 slim .. 1.12 stocky
  tall: number // 0.94 .. 1.06
  female?: boolean
}

export interface AgentMeta {
  id: string
  name: string
  role: string
  team: TeamId
  desc: string
  look: Look
  desk: { x: number; z: number; rot: number }
}

/**
 * One entry per Hermes profile. `id` must match the profile name the API
 * serves; every baris here has a desk in the scene.
 *
 * Desk rotation: 0 faces -z, PI faces +z, PI/2 faces -x, -PI/2 faces +x.
 */
export const AGENTS: AgentMeta[] = [
  {
    id: 'default',
    name: 'Galuh',
    role: 'ASISTEN UTAMA',
    team: 'lobby',
    desc: 'Pintu masuk semua permintaan pengguna lewat Telegram dan chat. Urusan produktivitas: memori, cron, email, review mingguan.',
    look: {
      skin: '#e2ab88', hair: '#2b2320', style: 'long', shirt: '#efe6d6', pants: '#4a3a52',
      accent: '#d4805c', hijab: '#b3797e', skirt: true, build: 0.9, tall: 1.0, female: true,
    },
    desk: { x: -7.0, z: 9.2, rot: Math.PI },
  },
  {
    id: 'dev',
    name: 'Bima',
    role: 'SDLC LEAD',
    team: 'dev',
    desc: 'Koordinator tim pengembangan. Memecah permintaan lalu mendelegasikan ke Raka, Laras, Dimas, Yoga, dan Sari.',
    look: {
      skin: '#a9744f', hair: '#221a17', style: 'crop', shirt: '#4d6b86', pants: '#2c2f33',
      accent: '#82aac8', build: 1.12, tall: 1.02, stubble: true,
    },
    desk: { x: -14.5, z: -4.4, rot: Math.PI },
  },
  {
    id: 'planner',
    name: 'Raka',
    role: 'ANALIS & ARSITEK',
    team: 'dev',
    desc: 'Menganalisis requirement dan codebase, menyusun desain teknis, lalu rencana kecil bertag [fe]/[be]/[db].',
    look: {
      skin: '#b9825c', hair: '#2a211d', style: 'side', shirt: '#33405f', pants: '#565040',
      accent: '#80aa8c', glasses: true, build: 0.9, tall: 1.05,
    },
    desk: { x: -10.0, z: -4.4, rot: Math.PI },
  },
  {
    id: 'uiux',
    name: 'Laras',
    role: 'UI/UX DESIGNER',
    team: 'dev',
    desc: 'User flow, spec layar lengkap dengan semua state, wireframe HTML, dan kriteria UI. Bisa review tampilan lewat screenshot.',
    look: {
      skin: '#d4a684', hair: '#241c19', style: 'long', shirt: '#b26870', pants: '#3a3846',
      accent: '#d67a92', build: 0.9, tall: 0.98, female: true,
    },
    desk: { x: -5.5, z: -4.4, rot: Math.PI },
  },
  {
    id: 'coder',
    name: 'Dimas',
    role: 'IMPLEMENTER',
    team: 'dev',
    desc: 'Menulis kode produksi sesuai rencana, menjalankan test, dan memperbaiki temuan reviewer sampai hijau.',
    look: {
      skin: '#8d5f43', hair: '#1d1714', style: 'messy', shirt: '#3d4145', pants: '#20242e',
      accent: '#6e8fb4', headphones: '#465c78', build: 1.0, tall: 1.01, stubble: true,
    },
    desk: { x: -14.5, z: -8.4, rot: Math.PI },
  },
  {
    id: 'reviewer',
    name: 'Yoga',
    role: 'CODE REVIEW',
    team: 'dev',
    desc: 'Membaca diff, mencari bug, risiko, dan pelanggaran konvensi. Memberi catatan yang bisa langsung dikerjakan.',
    look: {
      skin: '#c08a63', hair: '#2c2420', style: 'short', shirt: '#7a6a52', pants: '#33302b',
      accent: '#b59a6a', glasses: true, build: 0.98, tall: 1.0,
    },
    desk: { x: -10.0, z: -8.4, rot: Math.PI },
  },
  {
    id: 'tester',
    name: 'Sari',
    role: 'QA',
    team: 'dev',
    desc: 'Menyusun dan menjalankan skenario uji, menelusuri regresi, lalu melaporkan langkah reproduksi yang jelas.',
    look: {
      skin: '#d2a17e', hair: '#2a211e', style: 'bun', shirt: '#5c7a6a', pants: '#3b3a3f',
      accent: '#8fc0a0', build: 0.92, tall: 0.99, female: true,
    },
    desk: { x: -5.5, z: -8.4, rot: Math.PI },
  },
  {
    id: 'edu',
    name: 'Ayu',
    role: 'EDU LEAD',
    team: 'edu',
    desc: 'Memimpin tim materi: memecah unit, menjaga mutu, dan mengoordinasikan Nisa, Yohan, dan Hadi.',
    look: {
      skin: '#c48f6a', hair: '#241d1a', style: 'bun', shirt: '#8a6a3e', pants: '#3a3230',
      accent: '#deb860', build: 0.98, tall: 1.0, female: true,
    },
    desk: { x: 12.25, z: -4.4, rot: Math.PI },
  },
  {
    id: 'edu-designer',
    name: 'Nisa',
    role: 'DESAIN INSTRUKSIONAL',
    team: 'edu',
    desc: 'Merancang alur belajar, RPS, dan aktivitas kelas dengan struktur ADDIE yang rapi.',
    look: {
      skin: '#d7ab88', hair: '#2b2220', style: 'long', shirt: '#6b7f5a', pants: '#3d3a42',
      accent: '#a8c078', build: 0.9, tall: 0.98, female: true,
    },
    desk: { x: 7.75, z: -4.4, rot: Math.PI },
  },
  {
    id: 'edu-writer',
    name: 'Yohan',
    role: 'PENULIS MATERI',
    team: 'edu',
    desc: 'Menulis modul, jobsheet, dan slide yang siap dipakai mengajar, lengkap dengan contoh.',
    look: {
      skin: '#a87a58', hair: '#211a17', style: 'side', shirt: '#4a5566', pants: '#38342e',
      accent: '#8ea8c0', build: 0.96, tall: 1.04,
    },
    desk: { x: 12.25, z: -8.4, rot: Math.PI },
  },
  {
    id: 'edu-reviewer',
    name: 'Hadi',
    role: 'QA MATERI',
    team: 'edu',
    desc: 'Memeriksa materi terhadap kisi-kisi dan rubrik, menandai bagian yang belum terukur atau salah konsep.',
    look: {
      skin: '#b98a64', hair: '#332a26', style: 'crop', shirt: '#6e5a48', pants: '#2f2b27',
      accent: '#c0a080', glasses: true, build: 1.02, tall: 0.99,
    },
    desk: { x: 7.75, z: -8.4, rot: Math.PI },
  },
]

export const TEAMS: Record<TeamId, { label: string; name: string; sub: string; accent: string }> = {
  lobby: { label: 'PENDOPO', name: 'Pendopo', sub: 'penerima tamu', accent: '#d4805c' },
  dev: { label: 'TIM DEV', name: 'Tim Dev', sub: 'pengembangan aplikasi', accent: '#82aac8' },
  edu: { label: 'TIM EDU', name: 'Tim Edu', sub: 'materi kuliah & pelatihan', accent: '#deb860' },
}

export const AGENT_BY_ID: Record<string, AgentMeta> = Object.fromEntries(
  AGENTS.map((a) => [a.id, a]),
)

/** Deep links accept either the profile id or the display name. */
export function resolveAgentId(token: string): string | null {
  const t = token.trim().toLowerCase()
  if (!t) return null
  if (AGENT_BY_ID[t]) return t
  const byName = AGENTS.find((a) => a.name.toLowerCase() === t)
  return byName ? byName.id : null
}

/** Profile display helper: unknown profiles get a readable fallback. */
export function agentMeta(id: string): AgentMeta {
  const found = AGENT_BY_ID[id]
  if (found) return found
  return {
    id,
    name: id,
    role: 'AGEN',
    team: 'lobby',
    desc: 'Profil Hermes tanpa desk khusus.',
    look: {
      skin: '#c99772', hair: '#2a2220', style: 'short', shirt: '#5a6570', pants: '#33383d',
      accent: '#93a1ae', build: 1, tall: 1,
    },
    desk: { x: 5.0, z: 8.6, rot: Math.PI },
  }
}