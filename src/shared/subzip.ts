// Subtitle archives (Subdl sends .zip, AniSub .rar): take out the subtitle of the wanted episode.
// Shared by the desktop and phone apps.
import { unzipSync } from 'fflate'
import { episodeOf } from './episode'

const SUB = /\.(ass|ssa|srt|vtt)$/i

/** Where the RAR decoder's WebAssembly comes from (the phone app hands it over; Node finds it itself). */
let rarWasm: (() => Promise<ArrayBuffer>) | null = null
export function setRarWasm(load: () => Promise<ArrayBuffer>) {
  rarWasm = load
}

async function unrar(bytes: Uint8Array): Promise<[string, Uint8Array][]> {
  // The decoder (Emscripten) hooks Node's uncaughtException / unhandledRejection and exits the whole
  // process on any later stray error (the app closed itself): take those hooks off again.
  const proc: any = (globalThis as any).process
  const events = ['uncaughtException', 'unhandledRejection']
  const before = proc?.listeners ? events.map(e => proc.listeners(e) as unknown[]) : null
  const { createExtractorFromData } = await import('node-unrar-js')
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  let ex
  try {
    ex = await createExtractorFromData({ data, wasmBinary: rarWasm ? await rarWasm() : undefined })
  } finally {
    if (before) events.forEach((e, i) => proc.listeners(e).forEach((l: any) => before[i].includes(l) || proc.removeListener(e, l)))
  }
  const names = [...ex.getFileList().fileHeaders].filter(h => !h.flags.directory && SUB.test(h.name)).map(h => h.name)
  const out: [string, Uint8Array][] = []
  for (const f of ex.extract({ files: names }).files) if (f.extraction) out.push([f.fileHeader.name, f.extraction])
  return out
}

/** The bytes of a downloaded subtitle, unpacked when it is an archive. `url` may carry "#ep=52,1". */
export async function unpackSubtitle(bytes: Uint8Array, url: string): Promise<Uint8Array> {
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b // "PK"
  const rar = bytes[0] === 0x52 && bytes[1] === 0x61 && bytes[2] === 0x72 && bytes[3] === 0x21 // "Rar!"
  if (!zip && !rar) return bytes
  const files = (zip ? Object.entries(unzipSync(bytes)) : await unrar(bytes)).filter(
    ([name, data]) => SUB.test(name) && data.length > 0 && !name.startsWith('__MACOSX')
  )
  if (!files.length) throw new Error('Arşivde altyazı dosyası yok.')
  // "#ep=52,1": the episode's absolute number and its number within the season.
  const eps = (/#ep=([\d,]+)/.exec(url)?.[1] ?? '').split(',').filter(Boolean).map(Number)
  if (files.length > 1 && eps.length) {
    const hit = files.find(([name]) => eps.some(n => episodeOf(name) === n || new RegExp(`\\(0*${n}\\)`).test(name)))
    if (hit) return hit[1]
    throw new Error(`Arşivde ${eps[0]}. bölümün altyazısı yok.`)
  }
  // ASS keeps styling: prefer it over SRT for the same episode.
  return (files.find(([n]) => /\.(ass|ssa)$/i.test(n)) ?? files[0])[1]
}
