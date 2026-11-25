// Anime hidden from "İzlemeye devam et" (only in this app: the list on AniList / MAL is not touched).
// Brought back from Listem → Gizlenenler.
import { useEffect, useState } from 'react'

const KEY = 'anisaki:cwHidden'
const EVENT = 'anisaki:cwHidden'

export function hiddenIds(): number[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v.filter(n => typeof n === 'number') : []
  } catch {
    return []
  }
}

function save(ids: number[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...new Set(ids)]))
  } catch {}
  window.dispatchEvent(new Event(EVENT))
}

export const hideFromContinue = (id: number) => save([...hiddenIds(), id])
export const unhideFromContinue = (id: number) => save(hiddenIds().filter(x => x !== id))

/** The hidden ids, kept current when they change anywhere in the app. */
export function useHidden(): number[] {
  const [ids, setIds] = useState(hiddenIds)
  useEffect(() => {
    const on = () => setIds(hiddenIds())
    window.addEventListener(EVENT, on)
    window.addEventListener('storage', on)
    return () => {
      window.removeEventListener(EVENT, on)
      window.removeEventListener('storage', on)
    }
  }, [])
  return ids
}
