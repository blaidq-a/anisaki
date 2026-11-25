// Shared by the main process (picking files in debrid torrents) and the UI (ranking sources).

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p

/** Episode number in a release file name ("Show - 05", "S01E05", "Episode 5", "第5話"…), or null. */
export function episodeOf(file: string): number | null {
  const s = baseName(file).replace(/\.[^.]+$/, '').replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/[._]/g, ' ')
  const m =
    /S\d{1,2}\s*E(\d{1,4})/i.exec(s) ??
    /\b(?:E|EP|Episode|Ep\.)\s*(\d{1,4})\b/i.exec(s) ??
    /第\s*(\d{1,4})\s*[話话]/.exec(s) ??
    /\s-\s*(\d{1,4})(?:v\d)?(?:\s|$)/.exec(s) ??
    /\s(\d{1,4})(?:v\d)?\s*$/.exec(s) ??
    /\[(\d{1,3})(?:v\d)?\]/.exec(baseName(file)) // "[DBD-Raws][05][2160P]…"
  return m ? parseInt(m[1], 10) : null
}
