// Dialogue cues of an ASS script (for "pick the line you just heard" and automatic subtitle sync).
export interface Cue {
  start: number
  end: number
  text: string
}

const ts = (s: string) => {
  const [h, m, sec] = s.split(':')
  return Number(h) * 3600 + Number(m) * 60 + Number(sec)
}

/** Dialogue cues of an ASS script. Signs, songs and positioned text are left out: they aren't speech. */
export function parseCues(ass: string): Cue[] {
  const fmt = /^Format:\s*(.*)$/m.exec(ass.slice(ass.indexOf('[Events]')))?.[1]?.split(',').map(s => s.trim().toLowerCase())
  const iStart = fmt?.indexOf('start') ?? 1
  const iEnd = fmt?.indexOf('end') ?? 2
  const iStyle = fmt?.indexOf('style') ?? 3
  const n = fmt?.length ?? 10
  const out: Cue[] = []
  for (const line of ass.split(/\r?\n/)) {
    if (!line.startsWith('Dialogue:')) continue
    const parts = line.slice(9).split(',')
    if (parts.length < n) continue
    const text = parts.slice(n - 1).join(',')
    const style = parts[iStyle]?.trim() ?? ''
    if (/sign|song|lyric|kara|title|^op|^ed|insert/i.test(style)) continue
    if (/\\(pos|move|an[789]|p[1-9])/.test(text)) continue
    const plain = text.replace(/\{[^}]*\}/g, '').replace(/\\[Nnh]/g, ' ').trim()
    if (!plain) continue
    out.push({ start: ts(parts[iStart].trim()), end: ts(parts[iEnd].trim()), text: plain })
  }
  return out.sort((a, b) => a.start - b.start)
}
