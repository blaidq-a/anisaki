// A debrid key built into this copy of the app (for friends who have no key of their own). The data
// lives in embedded.gen.ts, which scripts/embed-key.cjs generates and git ignores; without it there is
// no built-in key. It is scrambled, not secret: a determined person could still recover it.

// @ts-ignore — Vite feature; the file may not exist
const mods = import.meta.glob('./embedded.gen.ts', { eager: true }) as Record<string, { P: [number, number, string][]; N: number }>
const gen = Object.values(mods)[0]

let cached: string | null | undefined
export function builtinTorBoxKey(): string | null {
  if (cached !== undefined) return cached
  cached = null
  if (!gen) return null
  const enc = Buffer.alloc(gen.N)
  const pad = Buffer.alloc(gen.N)
  for (const [at, tag, b64] of gen.P) Buffer.from(b64, 'base64').copy(tag ? pad : enc, at)
  cached = Buffer.from(enc.map((b, i) => b ^ pad[i] ^ ((i * 151 + 7) & 255))).toString('utf8')
  return cached
}
