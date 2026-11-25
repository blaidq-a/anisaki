// Subtitle files for the desktop player (Tauri): online subtitles downloaded in the page (zip/rar opened,
// old encodings fixed, SRT/VTT turned into ASS) and written to the subtitle folder by Rust, where mpv
// loads them. Embedded subtitles are read out of the video by ffmpeg on the Rust side.
import { invoke, Channel } from '@tauri-apps/api/core'
import { setRarWasm, unpackSubtitle } from '../../../shared/subzip'
// @ts-ignore — Vite asset import
import unrarWasm from 'node-unrar-js/esm/js/unrar.wasm?url'
setRarWasm(() => fetch(unrarWasm).then(r => r.arrayBuffer()))

export async function sha16(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(d), b => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
}

const LEGACY = (lang?: string) =>
  /^(tur|tr)/i.test(lang ?? '') ? 'windows-1254' : /^(ara|ar)/i.test(lang ?? '') ? 'windows-1256' : /^(rus|ru|ukr|uk|bul|bg)/i.test(lang ?? '') ? 'windows-1251' : 'windows-1252'

/** Text of an online subtitle (any encoding; zip/rar/gzip opened), as ASS. */
export async function subtitleText(url: string, lang?: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error('Altyazı indirilemedi (HTTP ' + res.status + ')')
  let bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer())
  bytes = new Uint8Array(await unpackSubtitle(bytes as any, url)) // zip archives (Subdl), rar (AniSub)
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    // Most Turkish subtitles that aren't UTF-8 are Windows-1254.
    text = new TextDecoder(LEGACY(lang)).decode(bytes)
  }
  text = text.replace(/^﻿/, '')
  return /^\s*\[Script Info\]/i.test(text) ? wrapLines(text) : toAss(text)
}

/** Long lines break onto the next line instead of running off the screen (WrapStyle 0: smart wrap). */
export function wrapLines(ass: string): string {
  if (/^WrapStyle:.*$/im.test(ass)) return ass.replace(/^WrapStyle:.*$/im, 'WrapStyle: 0')
  return ass.replace(/^\[Script Info\][^\n]*\n/im, m => m + 'WrapStyle: 0\n')
}

const assTime = (s: number) => {
  const cs = Math.max(0, Math.round(s * 100))
  const h = Math.floor(cs / 360000)
  const m = Math.floor((cs % 360000) / 6000)
  const sec = Math.floor((cs % 6000) / 100)
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`
}
const clock = (t: string) => {
  const m = /(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})/.exec(t)
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000 : NaN
}

/** SRT / WebVTT → ASS with one plain style (the player's look settings restyle it). */
export function toAss(text: string): string {
  const rows: string[] = []
  for (const block of text.replace(/\r/g, '').split(/\n{2,}/)) {
    const lines = block.split('\n')
    const i = lines.findIndex(l => l.includes('-->'))
    if (i < 0) continue
    const [a, b] = lines[i].split('-->')
    const start = clock(a), end = clock(b)
    if (isNaN(start) || isNaN(end)) continue
    const body = lines
      .slice(i + 1)
      .join('\\N')
      .replace(/<\s*i\s*>/gi, '{\\i1}').replace(/<\s*\/\s*i\s*>/gi, '{\\i0}')
      .replace(/<\s*b\s*>/gi, '{\\b1}').replace(/<\s*\/\s*b\s*>/gi, '{\\b0}')
      .replace(/<[^>]+>/g, '')
      .trim()
    if (body) rows.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Default,,0,0,0,,${body}`)
  }
  return [
    '[Script Info]', 'ScriptType: v4.00+', 'WrapStyle: 0', 'PlayResX: 384', 'PlayResY: 288', 'ScaledBorderAndShadow: yes', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: Default,Arial,16,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,1,0.5,2,12,12,12,1', '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...rows, ''
  ].join('\n')
}

/** Online subtitle → ASS file in the subtitle folder, for mpv's sub-add. */
export async function subtitleFile(url: string, lang?: string): Promise<string> {
  const text = await subtitleText(url, lang)
  return invoke<string>('subs_write', { name: (await sha16(url)) + '.ass', text })
}

export const subsDir = (() => {
  let d: Promise<string> | null = null
  return () => (d ??= invoke<string>('subs_dir_path'))
})()
export const baseName = (p: string) => p.split(/[\\/]/).pop()!
export const readSub = (file: string) => invoke<string>('subs_read', { name: baseName(file) })
export const writeSub = (name: string, text: string) => invoke<string>('subs_write', { name, text })
export const subExists = (name: string) => invoke<boolean>('subs_exists', { name })

/**
 * Reads one embedded subtitle stream as ASS: the header once, then the dialogue rows as ffmpeg reaches
 * them (it reads the file much faster than playback).
 */
export function readEmbedded(src: string, subIndex: number, onBytes: (n: number) => void, onHead: (head: string) => void, onLines: (rows: string[]) => void, signal: AbortSignal, from?: number): Promise<void> {
  const id = Math.random().toString(36).slice(2)
  let buf = ''
  let head = ''
  let inEvents = false
  let total = 0
  const on = new Channel<string>()
  on.onmessage = d => {
    total += d.length
    onBytes(total)
    buf += d
    const lines = buf.split(/\r?\n/)
    buf = lines.pop() ?? ''
    const rows: string[] = []
    for (const l of lines) {
      if (!inEvents) {
        head += l + '\n'
        if (/^Format:/.test(l) && head.includes('[Events]')) {
          inEvents = true
          onHead(wrapLines(head))
        }
      } else if (l.startsWith('Dialogue:')) rows.push(l)
    }
    if (rows.length) onLines(rows)
  }
  const stop = () => invoke('sub_extract_cancel', { id })
  signal.addEventListener('abort', stop, { once: true })
  return invoke<void>('sub_extract', { id, src, subIndex, from: from ?? null, on }).then(
    () => {
      signal.removeEventListener('abort', stop)
      if (buf.startsWith('Dialogue:')) onLines([buf])
      if (!inEvents) throw new Error('Altyazı dosyadan okunamadı')
    },
    e => {
      signal.removeEventListener('abort', stop)
      throw new Error(String(e))
    }
  )
}
