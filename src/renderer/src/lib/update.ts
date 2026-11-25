// Updates for the PC, phone and TV apps. A small manifest (latest.json) on the release host names the newest
// version and its files; "Güncelle" downloads the right one and installs it (PC: the installer runs and the
// app closes; Android: the system installer opens). The release host isn't set yet (the code is in a
// private repository, which apps can't download from without a key): until it is, updates are off.
import { invoke } from '@tauri-apps/api/core'
import { getVersion } from '@tauri-apps/api/app'

/** latest.json on the release host; empty = updates off. */
// The repository's latest.json (raw.githubusercontent.com lets the app read it; a release download link may
// not). It answers only once the repository is public; until then the check fails quietly.
export const UPDATE_URL = 'https://raw.githubusercontent.com/blaidq-a/anisaki/master/latest.json'
/** How the version is shown (the build number is 0.1.1; this is its first, alpha release). */
export const VERSION_LABEL = '0.1.1 alfa'

export interface Release {
  version: string
  notes?: string
  /** installer (.exe) for Windows */
  windows?: string
  /** .apk for phones and TVs */
  android?: string
}

export const updatesOn = () => !!UPDATE_URL

const parts = (v: string) => v.replace(/^v/, '').split(/[.-]/).slice(0, 3).map(n => Number(n) || 0)
/** a newer than b? (major.minor.patch) */
export function newer(a: string, b: string) {
  const x = parts(a), y = parts(b)
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]
  return false
}

export async function currentVersion() {
  try {
    return await getVersion()
  } catch {
    return '0.1.1'
  }
}

/** The newer release, if there is one (null: up to date, or updates off). */
export async function checkUpdate(): Promise<Release | null> {
  if (!UPDATE_URL) return null
  const r = await fetch(UPDATE_URL, { cache: 'no-store' })
  if (!r.ok) throw new Error('Güncelleme bilgisi alınamadı (' + r.status + ')')
  const rel = (await r.json()) as Release
  const mobile = !!(window as any).ANISAKI_MOBILE
  if (!rel?.version || !(mobile ? rel.android : rel.windows)) return null
  return newer(rel.version, await currentVersion()) ? rel : null
}

/** Download and install it (the app closes on a PC; Android shows its installer). */
export async function installUpdate(rel: Release) {
  if ((window as any).ANISAKI_MOBILE) await invoke('player_call', { method: 'installApk', args: { url: rel.android } })
  else await invoke('update_install', { url: rel.windows })
}
