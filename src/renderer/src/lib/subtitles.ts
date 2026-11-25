// ASS/SSA rendering with libass (JASSUB) on a canvas we position over the visible video area.
// Canvas mode is used because the <video> may be hidden under the Anime4K canvas, and because the
// player's clock (offset + currentTime) differs from video.currentTime while transcoding.
import { getUiLang } from './i18n'
import JASSUB from 'jassub'

export class SubtitleLayer {
  private inst: JASSUB | null = null
  private canvas: HTMLCanvasElement | null = null
  private ready = false
  private gen = 0

  constructor(private host: HTMLElement) {}

  /** Start rendering a new track. Each track gets a fresh canvas (JASSUB transfers it to its worker). */
  async load(content: string, fonts: string[] = []): Promise<void> {
    const my = ++this.gen
    await this.clear()
    const canvas = document.createElement('canvas')
    canvas.className = 'subs-canvas'
    this.host.appendChild(canvas)
    this.canvas = canvas
    const inst = new JASSUB({ canvas, subContent: content, fonts, queryFonts: false })
    this.inst = inst
    await inst.ready
    if (my !== this.gen) return void inst.destroy()
    this.ready = true
  }

  /** Replace the track contents (used while embedded subtitles are still streaming in). */
  async update(content: string): Promise<void> {
    if (this.inst && this.ready) await this.inst.renderer.setTrack(content)
  }

  render(mediaTime: number, videoWidth: number, videoHeight: number): void {
    if (!this.inst || !this.ready || !videoWidth) return
    this.inst.manualRender({ expectedDisplayTime: performance.now(), width: videoWidth, height: videoHeight, mediaTime })
  }

  /** Place the canvas over the area where the video picture actually is (object-fit: contain). */
  layout(box: { x: number; y: number; width: number; height: number }): void {
    if (!this.canvas) return
    Object.assign(this.canvas.style, { left: box.x + 'px', top: box.y + 'px', width: box.width + 'px', height: box.height + 'px' })
    if (this.inst && this.ready) this.inst.resize(true)
  }

  async clear(): Promise<void> {
    this.ready = false
    const inst = this.inst
    this.inst = null
    this.canvas?.remove()
    this.canvas = null
    if (inst) await inst.destroy().catch(() => {})
  }
}

/**
 * Read a streamed ASS response, calling onText with the full text so far (throttled).
 * Each call is awaited, so updates are applied in order and the final one is never lost.
 */
export async function streamText(url: string, onText: (text: string, done: boolean) => void | Promise<void>, signal: AbortSignal): Promise<void> {
  const res = await fetch(url, { signal })
  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  let text = ''
  let last = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    text += dec.decode(value, { stream: true })
    if (performance.now() - last > 1500) {
      await onText(text, false)
      last = performance.now()
    }
  }
  await onText(text + dec.decode(), true)
}

const LANG: Record<string, string> = {
  jpn: 'ja', ja: 'ja', eng: 'en', en: 'en', tur: 'tr', tr: 'tr', ger: 'de', deu: 'de', fre: 'fr', fra: 'fr', spa: 'es', es: 'es', ita: 'it',
  zht: 'zh-Hant', zhs: 'zh-Hans', ze: 'zh', por: 'pt', pob: 'pt-BR', 'pt-br': 'pt-BR', rus: 'ru', ara: 'ar', chi: 'zh', zho: 'zh', kor: 'ko', pol: 'pl', ind: 'id', may: 'ms', msa: 'ms',
  tha: 'th', vie: 'vi', hin: 'hi', ukr: 'uk', dut: 'nl', nld: 'nl', swe: 'sv', fin: 'fi', heb: 'he', hun: 'hu', cze: 'cs', ces: 'cs', rum: 'ro',
  ron: 'ro', gre: 'el', ell: 'el', bul: 'bg', dan: 'da', nor: 'no', per: 'fa', fas: 'fa'
}
const names = new Intl.DisplayNames([getUiLang()], { type: 'language' })

export function langCode(l: string | null | undefined): string | null {
  if (!l || l === 'und') return null
  return LANG[l.toLowerCase()] ?? l.toLowerCase()
}

export function langName(l: string | null | undefined): string {
  const c = langCode(l)
  if (!c) return 'Bilinmeyen dil'
  try {
    const n = names.of(c)
    return n ? n.charAt(0).toLocaleUpperCase('tr') + n.slice(1) : c
  } catch {
    return c
  }
}
