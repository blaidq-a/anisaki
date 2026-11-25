// AniList / MyAnimeList sign-in: both sites send the browser back to Anisaki's sign-in page on GitHub Pages
// (pages/giris.html), which passes the sign-in on to the Anisaki waiting for it. On a PC or phone that is
// the device itself (127.0.0.1:43219). A TV has no browser to sign in with: it shows a QR code, the phone
// signs in, and the page sends the sign-in to the TV's address on the home network.
import { invoke } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'

export const LOGIN_PAGES = 'https://blaidq-a.github.io/anisaki/'
/** The address registered at AniList and MyAnimeList as the app's redirect URL */
export const LOGIN_REDIRECT = LOGIN_PAGES + 'giris.html'

const isTv = () => document.documentElement.classList.contains('tv')

type Qr = { url: string; service: string } | null
const qrListeners = new Set<(q: Qr) => void>()
let qr: Qr = null
const setQr = (q: Qr) => ((qr = q), qrListeners.forEach(f => f(q)))
/** The QR code the TV shows while a sign-in waits for the phone (null: none) */
export const onLoginQr = (cb: (q: Qr) => void) => (cb(qr), qrListeners.add(cb), () => void qrListeners.delete(cb))

/**
 * Opens the sign-in (`authorize`: the site's own sign-in address) and waits for it to come back through
 * `wait` (the Rust listener; `lan` = also on the home network, for the TV).
 */
export async function signIn(service: string, authorize: string, wait: (lan: boolean) => Promise<string>): Promise<string> {
  const tv = isTv()
  const ip = tv ? await invoke<string | null>('lan_ip').catch(() => null) : '127.0.0.1'
  if (!ip) throw new Error('TV bir Wi-Fi ya da kablolu ağa bağlı görünmüyor; QR ile giriş için telefonla aynı ağda olmalı.')
  const result = wait(tv)
  const url = `${LOGIN_PAGES}basla.html?to=${ip}&go=${encodeURIComponent(authorize)}`
  if (tv) setQr({ url, service })
  else await openUrl(url)
  try {
    return await result
  } finally {
    if (tv) setQr(null)
  }
}
