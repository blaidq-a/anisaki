// Pieces shared by the players: icons, formatting, the chapter-split seek bar and OP/ED detection.
import { useEffect, useMemo, useRef, useState } from 'react'

export const fmt = (s: number) => {
  if (!isFinite(s) || s < 0) s = 0
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60).toString().padStart(2, '0')
  return h ? `${h}:${m.toString().padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

const CODEC: Record<string, string> = {
  aac: 'AAC', opus: 'Opus', flac: 'FLAC', mp3: 'MP3', vorbis: 'Vorbis', ac3: 'Dolby Digital (AC3)', eac3: 'Dolby Digital Plus (EAC3)', dts: 'DTS',
  truehd: 'Dolby TrueHD', h264: 'H.264 (AVC)', hevc: 'H.265 (HEVC)', av1: 'AV1', vp9: 'VP9', ass: 'ASS', ssa: 'SSA', subrip: 'SRT',
  hdmv_pgs_subtitle: 'PGS (görüntü)', dvd_subtitle: 'VobSub (görüntü)', webvtt: 'WebVTT', mov_text: 'MP4 metin'
}
export const codec = (c: string | null | undefined) => (c ? CODEC[c] ?? c.toUpperCase() : '—')
export const channelsLabel = (n: number | null | undefined) =>
  !n ? '' : n === 1 ? 'Mono' : n === 2 ? 'Stereo' : n === 6 ? '5.1' : n === 8 ? '7.1' : n + ' kanal'

export const Icon = ({ d, size = 22 }: { d: string; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
    <path d={d} fill="currentColor" />
  </svg>
)

export const I = {
  play: 'M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z',
  pause: 'M7 5h3.5v14H7zm6.5 0H17v14h-3.5z',
  back10: 'M12 5V2L7 6l5 4V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8zm-1.1 11h-1V11.6l-1.2.4v-.9l2.1-.8h.1zm4.5-2c0 1.4-.6 2.1-1.6 2.1s-1.6-.7-1.6-2.1v-.8c0-1.4.6-2.1 1.6-2.1s1.6.7 1.6 2.1zm-1 .1v-1c0-.8-.2-1.2-.6-1.2s-.6.4-.6 1.2v1c0 .8.2 1.2.6 1.2s.6-.4.6-1.2z',
  fwd10: 'M12 5V2l5 4-5 4V7a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8zm-1.1 11h-1V11.6l-1.2.4v-.9l2.1-.8h.1zm4.5-2c0 1.4-.6 2.1-1.6 2.1s-1.6-.7-1.6-2.1v-.8c0-1.4.6-2.1 1.6-2.1s1.6.7 1.6 2.1zm-1 .1v-1c0-.8-.2-1.2-.6-1.2s-.6.4-.6 1.2v1c0 .8.2 1.2.6 1.2s.6-.4.6-1.2z',
  vol: 'M4 9v6h4l5 5V4L8 9zm12.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z',
  mute: 'M4 9v6h4l5 5V4L8 9zm12.6 3 2.4-2.4-1.1-1.1-2.4 2.4-2.4-2.4L12 9.6l2.4 2.4-2.4 2.4 1.1 1.1 2.4-2.4 2.4 2.4 1.1-1.1z',
  cc: 'M19 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1zm7 0h-1.5v-.5h-2v3h2V13H18v1a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1z',
  audio: 'M12 3v10.55A4 4 0 1 0 14 17V7h4V3z',
  sparkle: 'M12 2l2.2 6.3L20.5 10l-6.3 2.2L12 18.5l-2.2-6.3L3.5 10l6.3-1.7zM19 15l1 2.6 2.6 1-2.6 1L19 22l-1-2.6-2.6-1 2.6-1z',
  info: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-6h2zm0-8h-2V7h2z',
  full: 'M5 5h5v2H7v3H5zm9 0h5v5h-2V7h-3zM5 14h2v3h3v2H5zm12 0h2v5h-5v-2h3z',
  next: 'M6 6l8.5 6L6 18zm10 0h2v12h-2z',
  close: 'M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7l-1.4-1.4L9.2 12 2.9 5.7l1.4-1.4 6.3 6.3 6.3-6.3z',
  skip: 'M5 6l7 6-7 6zm7 0l7 6-7 6z'
}

/* ------------------------------ segments (OP/ED) ------------------------------ */
export type SegmentKind = 'op' | 'ed' | 'recap' | 'preview' | 'normal'
export interface Segment {
  start: number
  end: number
  title: string
  kind: SegmentKind
}

const KIND_LABEL: Record<SegmentKind, string> = { op: 'Opening', ed: 'Ending', recap: 'Özet', preview: 'Sonraki bölüm fragmanı', normal: '' }

function kindOf(title: string): SegmentKind {
  const t = title.trim().toLowerCase()
  if (/^(op|opening|intro|opening song|オープニング|op\s*\d*|ncop)\b/.test(t) || /\bopening\b/.test(t)) return 'op'
  if (/^(ed|ending|outro|credits|ending song|エンディング|ed\s*\d*|nced)\b/.test(t) || /\b(ending|credits)\b/.test(t)) return 'ed'
  if (/\b(recap|previously|özet)\b/.test(t)) return 'recap'
  if (/\b(preview|next episode|予告)\b/.test(t)) return 'preview'
  return 'normal'
}

/** Chapters from the file (mpv chapter-list). */
export function segmentsFromChapters(chapters: { title?: string; time: number }[], duration: number): Segment[] {
  if (!chapters.length || !duration) return []
  return chapters.map((c, i) => {
    const end = i + 1 < chapters.length ? chapters[i + 1].time : duration
    const title = c.title || `Bölüm ${i + 1}`
    return { start: c.time, end, title, kind: kindOf(title) }
  })
}

/** OP/ED/recap times from AniSkip (community database keyed by MyAnimeList id). */
export async function aniSkip(malId: number, episode: number, duration: number): Promise<Segment[]> {
  const types = ['op', 'ed', 'mixed-op', 'mixed-ed', 'recap'].map(t => 'types[]=' + t).join('&')
  const res = await fetch(`https://api.aniskip.com/v2/skip-times/${malId}/${episode}?${types}&episodeLength=${Math.round(duration)}`)
  if (!res.ok) return []
  const json = await res.json()
  if (!json.found) return []
  // Exact "op"/"ed" entries win over "mixed-op"/"mixed-ed"; overlapping intervals are dropped.
  const ranked = [...json.results].sort((a: any, b: any) => Number(a.skipType.startsWith('mixed')) - Number(b.skipType.startsWith('mixed')))
  const marks: Segment[] = []
  for (const r of ranked) {
    const kind: SegmentKind = /op/.test(r.skipType) ? 'op' : /ed/.test(r.skipType) ? 'ed' : 'recap'
    const seg = { start: r.interval.startTime, end: Math.min(duration, r.interval.endTime), title: KIND_LABEL[kind], kind }
    if (seg.end > seg.start && !marks.some(m => seg.start < m.end && seg.end > m.start)) marks.push(seg)
  }
  marks.sort((a, b) => a.start - b.start)
  // Fill the gaps so the bar is split like chapters.
  const out: Segment[] = []
  let t = 0
  for (const m of marks) {
    if (m.start > t + 1) out.push({ start: t, end: m.start, title: '', kind: 'normal' })
    out.push(m)
    t = m.end
  }
  if (t < duration - 1) out.push({ start: t, end: duration, title: '', kind: 'normal' })
  return out
}

/** Chapters win when they name OP/ED; otherwise AniSkip; otherwise plain chapters. */
export function pickSegments(chapters: Segment[], skip: Segment[]): Segment[] {
  if (chapters.some(s => s.kind === 'op' || s.kind === 'ed')) return chapters
  if (skip.length) return skip
  return chapters
}

export const segmentLabel = (s: Segment) => s.title || KIND_LABEL[s.kind]

/* ---------------------------------- seek bar ---------------------------------- */
export function SeekBar({ duration, time, buffered, segments, onSeek, preview }: { duration: number; time: number; buffered: number; segments: Segment[]; onSeek: (t: number) => void; preview?: { at: (t: number) => string | undefined; request: (t: number) => void } }) {
  const [scrub, setScrub] = useState<number | null>(null)
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const shown = scrub ?? time
  // Parts in time order, inside 0..duration, without overlaps or holes. They are placed by time (not as
  // flex boxes), so the filled part always ends exactly under the thumb: chapters that started late,
  // ran past the end or came out of order used to leave a gap between the two.
  const parts = useMemo(() => {
    const D = duration || 1
    const list = [...segments]
      .map(s => ({ ...s, start: Math.max(0, Math.min(D, s.start)), end: Math.max(0, Math.min(D, s.end)) }))
      .filter(s => s.end - s.start > 0.5)
      .sort((a, b) => a.start - b.start)
    const out: Segment[] = []
    let t = 0
    for (const s of list) {
      const start = Math.max(s.start, t)
      if (s.end <= start) continue
      if (start > t + 0.5) out.push({ start: t, end: start, title: '', kind: 'normal' })
      out.push({ ...s, start })
      t = s.end
    }
    if (t < D - 0.5 || !out.length) out.push({ start: t, end: D, title: '', kind: 'normal' })
    return out.length > 1 ? out : [{ start: 0, end: D, title: '', kind: 'normal' as SegmentKind }]
  }, [segments, duration])

  const tAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect()
    const x = Math.max(0, Math.min(r.width, clientX - r.left))
    return { x, t: duration ? (x / r.width) * duration : 0 }
  }
  const hoverSeg = hover ? parts.find(p => hover.t >= p.start && hover.t < p.end) : null

  // Preview frame under the cursor: the nearest prepared frame; resting the mouse asks for this exact spot.
  const spot = hover ? Math.round(hover.t / 5) * 5 : null
  useEffect(() => {
    if (!preview || spot == null) return
    const timer = setTimeout(() => preview.request(spot), 150)
    return () => clearTimeout(timer)
  }, [spot, preview])
  const img = hover && preview ? preview.at(hover.t) : undefined

  return (
    <div
      className="seek"
      ref={ref}
      onPointerDown={e => {
        if (!duration) return
        e.currentTarget.setPointerCapture(e.pointerId)
        setScrub(tAt(e.clientX).t)
      }}
      onPointerMove={e => {
        const p = tAt(e.clientX)
        setHover(p)
        if (scrub != null) setScrub(p.t)
      }}
      onPointerUp={e => {
        if (scrub == null) return
        onSeek(tAt(e.clientX).t)
        setScrub(null)
      }}
      onPointerLeave={() => setHover(null)}
      role="slider"
      aria-label="Konum"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(shown)}
      aria-valuetext={fmt(shown)}
      tabIndex={0}
    >
      <div className="seek-parts">
        {parts.map((p, i) => {
          const D = duration || 1
          const len = p.end - p.start
          const played = Math.max(0, Math.min(1, (shown - p.start) / len))
          const buf = Math.max(0, Math.min(1, (buffered - p.start) / len))
          // a 3px gap between parts, taken from inside each part (so positions stay exact)
          const gapL = i > 0 ? 1.5 : 0
          const gapR = i < parts.length - 1 ? 1.5 : 0
          return (
            <div key={i} className={'seek-part k-' + p.kind} style={{ left: `calc(${(p.start / D) * 100}% + ${gapL}px)`, width: `max(2px, calc(${(len / D) * 100}% - ${gapL + gapR}px))` }}>
              <div className="seek-buf" style={{ width: buf * 100 + '%' }} />
              <div className="seek-fill" style={{ width: played * 100 + '%' }} />
            </div>
          )
        })}
      </div>
      <div className="seek-thumb" style={{ left: (duration ? (shown / duration) * 100 : 0) + '%' }} />
      {hover && duration > 0 && (
        <div className="seek-tip" style={{ left: Math.max(preview ? 86 : 0, Math.min((ref.current?.clientWidth ?? 0) - (preview ? 86 : 0), hover.x)) }}>
          {preview && (img ? <img className="seek-prev" src={img} alt="" /> : <div className="seek-prev empty" />)}
          {hoverSeg && segmentLabel(hoverSeg) && <span>{segmentLabel(hoverSeg)}</span>}
          {fmt(hover.t)}
        </div>
      )}
    </div>
  )
}
