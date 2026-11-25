// Subtitles for the phone's player (ExoPlayer can't take a subtitle that grows while it plays, so they are
// ready before it starts): online subtitles in the preferred languages, plus a translation into the main
// language when there is none. Same download / convert / translate code as the desktop; files are written
// by Rust into the app's cache.
import { getSubtitles } from '../../src/main/addons'
import { subtitleFile } from '../../src/renderer/src/desktop/subs'
import { translateToFile } from '../../src/renderer/src/desktop/translate'
import { langCode, langName } from '../../src/renderer/src/lib/subtitles'
import type { AddonSubtitle, PlayPayload, PublicSettings } from '../../src/shared/types'

export interface PlayerSub {
  uri: string
  lang: string
  label: string
  mime: string
}

const uri = (path: string) => 'file://' + path.replace(/\\/g, '/')

/**
 * Subtitles for an episode, best first: the main language (real, else translated from English), then the
 * other preferred languages. `status` reports progress for the opening screen.
 */
export async function prepareSubs(p: PlayPayload, s: PublicSettings, status: (msg: string) => void): Promise<PlayerSub[]> {
  if (!p.subIds) return []
  status('Altyazılar aranıyor…')
  let list: AddonSubtitle[] = []
  try {
    list = await Promise.race([getSubtitles(p.subIds.type, p.subIds.ids), new Promise<AddonSubtitle[]>(r => setTimeout(() => r([]), 10000))])
  } catch {
    list = []
  }
  const main = s.subLangs[0] || 'tr'
  const langs = [...new Set([...(s.subLangs.length ? s.subLangs : ['tr', 'en']), 'en'])]
  const out: PlayerSub[] = []
  const byLang = (l: string) => list.filter(x => langCode(x.lang) === l)

  for (const lang of langs) {
    for (const [i, sub] of byLang(lang).slice(0, 2).entries()) {
      try {
        const file = await subtitleFile(sub.url, sub.lang)
        out.push({ uri: uri(file), lang, label: `${langName(lang)} #${i + 1}`, mime: 'text/x-ssa' })
      } catch {
        /* skip a broken file */
      }
    }
  }

  // Nothing in the main language: translate the first English subtitle (same translator as the desktop).
  // With Töz on, Turkish comes live in the player (no wait before the episode); otherwise translated here.
  if (s.autoTranslate && main !== 'en' && !(s.localTranslate && main === 'tr') && !out.some(x => x.lang === main)) {
    const en = byLang('en')[0]
    if (en) {
      try {
        status(`${langName(main)} altyazı hazırlanıyor…`)
        const file = await translateToFile({ kind: 'addon', url: en.url, lang: en.lang }, p.names ?? [], pr => {
          if (pr.total) status(`${langName(main)} altyazı hazırlanıyor… %${Math.round((pr.done / pr.total) * 100)}`)
        }, main)
        out.unshift({ uri: uri(file), lang: main, label: `${langName(main)} (otomatik çeviri)`, mime: 'text/x-ssa' })
      } catch {
        /* play without the translation */
      }
    }
  }
  return out
}
