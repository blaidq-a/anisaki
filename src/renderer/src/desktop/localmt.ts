// On-device translation (Töz, English → Turkish) through Rust (src-tauri/src/localmt.rs). Lines are split
// into sentences and each goes through the repair rules of mtclean, like the old worker did.
import { invoke } from '@tauri-apps/api/core'
import { sentences, translateSentence } from '../../../main/mtclean'

let ready: Promise<boolean> | null = null
/** Töz ships with the app; only Turkish is translated on the device. */
export const localReady = (to: string) => (to.split('-')[0] === 'tr' ? (ready ??= invoke<boolean>('mt_ready').catch(() => false)) : Promise.resolve(false))
/** Part of the cache key: a new model version re-translates cached episodes. */
export const localKey = async (_to: string) => 'toz-anime-2'
export const warmLocal = () => invoke('mt_warm').catch(() => {})

export async function translateLocal(texts: string[], _from: string, _to: string, onProgress?: (done: number) => void, signal?: AbortSignal): Promise<string[]> {
  const out: string[] = []
  for (const t of texts) {
    if (signal?.aborted) throw new Error('Çeviri iptal edildi')
    const parts: string[] = []
    for (const s of sentences(t)) parts.push(await translateSentence(s, x => invoke<string>('mt_sentence', { text: x })))
    out.push(parts.join(' '))
    onProgress?.(out.length)
  }
  return out
}
