// Built-in TorBox key for the desktop (Tauri) build: same scrambled data as the desktop build (embedded.gen.ts).
// @ts-ignore — Vite feature; the file may not exist
const mods = import.meta.glob('../../../../main/embedded.gen.ts', { eager: true }) as Record<string, { P: [number, number, string][]; N: number }>
const gen = Object.values(mods)[0]
const b64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))
let cached: string | null | undefined
export function builtinTorBoxKey(): string | null {
  if (cached !== undefined) return cached
  cached = null
  if (!gen) return null
  const enc = new Uint8Array(gen.N)
  const pad = new Uint8Array(gen.N)
  for (const [at, tag, s] of gen.P) (tag ? pad : enc).set(b64(s), at)
  cached = new TextDecoder().decode(enc.map((b, i) => b ^ pad[i] ^ ((i * 151 + 7) & 255)))
  return cached
}
