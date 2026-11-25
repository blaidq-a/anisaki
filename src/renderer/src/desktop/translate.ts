// Subtitle translation for the desktop app (Tauri), same as the old main-process translate.ts: the subtitle
// is read (online file, or embedded in the video via ffmpeg), translated chunk by chunk with
// translate-core (on-device Töz / NLLB when switched on, the online translators otherwise), and written to
// the subtitle folder as it grows, so playback can start long before the end. Finished files are kept.
import { translateAss } from '../../../main/translate-core'
import * as settings from '../../../main/settings'
import { readEmbedded, sha16, subExists, subsDir, subtitleText, wrapLines, writeSub } from './subs'
import { localReady, translateLocal, localKey } from './localmt'

export type TranslateSource =
  | { kind: 'addon'; url: string; lang: string }
  /** An embedded subtitle stream; subIndex is its position among the file's subtitle streams (0:s:N) */
  | { kind: 'embedded'; src: string; subIndex: number; lang: string }

type Progress = (p: { done: number; total: number; stage: 'reading' | 'translating'; partial?: string; covered?: number; ahead?: number }) => void

/**
 * Where the viewer is (seconds): the lines around it are translated first, so a film resumed in the middle
 * or a seek forward doesn't wait for everything before it. The player updates it while it plays.
 */
let focusTime = 0
/**
 * Fansub fonts often have no Turkish letters (ğ ş ı İ): libass then draws just those letters in another
 * font, a little bigger and different. Translated subtitles use a font with full Latin coverage instead,
 * keeping sizes, colours and positions.
 */
const SAFE_FONTS = /^(arial|segoe ui|tahoma|verdana|trebuchet ms|calibri|roboto|open sans|noto sans|times new roman|georgia)\b/i
function turkishFonts(head: string) {
  return head.replace(/^(Style:\s*[^,]*,)([^,]*)/gim, (m, pre, font) => (SAFE_FONTS.test(font.trim()) ? m : pre + 'Arial'))
}

const focusListeners = new Set<() => void>()
export const setTranslateFocus = (t: number) => {
  focusTime = Math.max(0, t || 0)
  focusListeners.forEach(f => f())
}
/** Running jobs: several players can wait on the same one; it stops when the last of them cancels. */
const cache = new Map<string, { job: Promise<string>; ctl: AbortController; listeners: Set<Progress>; users: number }>()
const cancelled = () => new Error('Çeviri iptal edildi')
const langFrom = (l: string) => (/^(en|eng)/i.test(l) ? 'en' : 'auto')
const startOf = (row: string) => {
  const m = /^Dialogue:\s*[^,]*,([^,]+),/.exec(row)
  if (!m) return 0
  const [h, mi, se] = m[1].trim().split(':')
  return Number(h) * 3600 + Number(mi) * 60 + Number(se)
}

export async function translateToFile(source: TranslateSource, names: string[], onProgress: Progress, to = 'tr', signal?: AbortSignal): Promise<string> {
  to = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(to) ? to : 'tr'
  const local = !!settings.load().localTranslate && (await localReady(to))
  const parts: unknown[] = to === 'tr' ? ['v3', source, names] : ['v3', source, names, to]
  // the model and the version of the repair rules: a change re-translates cached episodes
  if (local) parts.push(await localKey(to), 'rules-3')
  parts.push('fonts-1')
  const key = await sha16(JSON.stringify(parts))
  const name = `${to}-${key}.ass`
  if ((await subExists(name)) && (await subExists(name + '.done'))) return (await subsDir()) + String.fromCharCode(92) + name
  let entry = cache.get(key)
  if (!entry) {
    const ctl = new AbortController()
    const listeners = new Set<Progress>()
    const job = run(ctl.signal, p => listeners.forEach(l => l(p)))
    entry = { job, ctl, listeners, users: 0 }
    cache.set(key, entry)
    const e = entry
    job.then(() => cache.get(key) === e && cache.delete(key), () => cache.get(key) === e && cache.delete(key))
  }
  const e = entry
  e.users++
  e.listeners.add(onProgress)
  let leave = () => {
    leave = () => {}
    e.listeners.delete(onProgress)
    if (--e.users <= 0) e.ctl.abort()
  }
  return new Promise<string>((resolve, reject) => {
    if (signal?.aborted) return leave(), reject(cancelled())
    signal?.addEventListener('abort', () => (leave(), reject(cancelled())), { once: true })
    e.job.then(
      f => (e.listeners.delete(onProgress), resolve(f)),
      err => (e.listeners.delete(onProgress), reject(err))
    )
  })

  async function run(signal: AbortSignal, onProgress: Progress): Promise<string> {
    const engine = local ? (t: string[], f: string, l: string, p?: (d: number) => void) => translateLocal(t, f, l, p, signal) : undefined
    const from = langFrom(source.lang)
    let head = ''
    let file = ''
    let version = 0
    const out: { start: number; row: string }[] = []
    // Lines waiting for translation (sorted by time), and whether the whole subtitle has been read yet
    const todo: { start: number; row: string }[] = []
    let total = 0
    let readAll = false
    let wake: (() => void) | null = null
    const poke = () => (wake?.(), (wake = null))
    const text = () => (out.sort((x, y) => x.start - y.start), turkishFonts(head) + out.map(o => o.row).join('\n') + '\n')
    // Each partial result is a new file: the player swaps tracks instead of reloading one (no blink).
    const write = async () => void (file = await writeSub(`${name}.p${++version}.ass`, text()))
    // Two readers can find the same row (the one from the start and the one from where the viewer jumped)
    const seen = new Set<string>()
    const add = (rows: string[]) => {
      rows = rows.filter(r => !seen.has(r) && (seen.add(r), true))
      if (!rows.length) return
      for (const row of rows) todo.push({ start: startOf(row), row })
      todo.sort((x, y) => x.start - y.start)
      total += rows.length
      poke()
    }
    /** How far translation reaches without a gap from the viewer's position (for the progress text) */
    // How far the readers have got: the one from the start, and the one from where the viewer jumped
    let readTo = 0
    let jump: { from: number; to: number; ctl: AbortController } | null = null
    const covers = (t: number) => readAll || readTo >= t || (!!jump && jump.from <= t && jump.to >= t)
    const ahead = () => {
      // the viewer is past what has been read: that part of the file is being read now (-1)
      if (!covers(focusTime)) return -1
      const pending = todo.find(t => t.start >= focusTime - 2)
      return pending ? pending.start : readAll ? Infinity : Math.max(focusTime, ...out.map(o => o.start))
    }
    /** Next batch: the untranslated lines from just before the viewer's position on, else the earliest left. */
    const nextBatch = (size: number) => {
      let i = todo.findIndex(t => t.start >= focusTime - 8)
      if (i < 0) i = 0
      return todo.splice(i, size)
    }

    const worker = async () => {
      let first = true
      while (true) {
        if (signal.aborted) throw cancelled()
        if (!todo.length) {
          if (readAll) return
          await new Promise<void>(r => (wake = r))
          continue
        }
        // Small first batch so something shows quickly, then bigger ones (a reader may still be filling in)
        const size = first ? (local ? 12 : 40) : local ? 48 : 100
        if (!readAll && first && todo.length < size) {
          await Promise.race([new Promise<void>(r => (wake = r)), new Promise(r => setTimeout(r, 1500))])
          if (todo.length < size && !readAll && todo.length < 4) continue
        }
        first = false
        const batch = nextBatch(size)
        const tr = await translateAss(head + batch.map(b => b.row).join('\n'), from, names, undefined, to, engine)
        if (signal.aborted) throw cancelled()
        for (const row of tr.split(/\r?\n/)) if (row.startsWith('Dialogue:')) out.push({ start: startOf(row), row })
        await write()
        onProgress({ stage: 'translating', done: out.length, total: readAll ? total : 0, partial: file, covered: Math.max(...out.map(o => o.start)), ahead: ahead() })
      }
    }

    if (source.kind === 'addon') {
      const ass = await subtitleText(source.url, source.lang)
      const lines = ass.split(/\r?\n/)
      const ev = lines.findIndex((l, i) => /^Format:/.test(l) && lines.slice(0, i).some(x => x.trim() === '[Events]'))
      head = wrapLines(lines.slice(0, ev + 1).join('\n') + '\n')
      add(lines.slice(ev + 1).filter(l => l.startsWith('Dialogue:')))
      readAll = true
      await worker()
    } else {
      onProgress({ stage: 'reading', done: 0, total: 0 })
      let headReady!: () => void
      const gotHead = new Promise<void>(r => (headReady = r))
      const reading = readEmbedded(
        source.src,
        source.subIndex,
        n => !out.length && onProgress({ stage: 'reading', done: n, total: 0 }),
        h => ((head = h), headReady()),
        rows => ((readTo = Math.max(readTo, ...rows.map(startOf))), add(rows)),
        signal
      ).finally(() => ((readAll = true), headReady(), poke(), jump?.ctl.abort()))
      // ffmpeg reads the file from the start (slowly over a torrent): when the viewer jumps past what it
      // has read, a second reader starts a little before that spot, so those lines come in seconds.
      const follow = () => {
        if (readAll || signal.aborted || focusTime < readTo + 60 || covers(focusTime + 30)) return
        if (jump && focusTime >= jump.from && focusTime <= jump.to + 90) return // that reader gets there soon
        jump?.ctl.abort()
        const ctl = new AbortController()
        const j = { from: Math.max(0, focusTime - 20), to: Math.max(0, focusTime - 20), ctl }
        jump = j
        signal.addEventListener('abort', () => ctl.abort(), { once: true })
        readEmbedded(source.src, source.subIndex, () => {}, h => (head ||= h), rows => ((j.to = Math.max(j.to, ...rows.map(startOf))), add(rows)), ctl.signal, j.from).catch(() => {})
      }
      focusListeners.add(follow)
      const tick = setInterval(follow, 2000)
      await gotHead
      try {
        follow()
        await Promise.all([reading, worker()])
      } finally {
        focusListeners.delete(follow)
        clearInterval(tick)
        ;(jump as { ctl: AbortController } | null)?.ctl.abort()
      }
    }
    if (signal.aborted) throw cancelled()
    file = await writeSub(name, text())
    await writeSub(name + '.done', '')
    return file
  }
}

