// Installs the Tauri window.api before the UI starts (imported first by main.tsx).
// First start after the move from Electron: the old app's settings (profiles, lists, addons, keys) are
// brought over once, before anything reads them.
import { invoke } from '@tauri-apps/api/core'

const KEY = 'fs:anisaki/settings.json'
try {
  if (localStorage.getItem(KEY) == null && !localStorage.getItem('anisaki:migrated')) {
    const old = await invoke<string | null>('electron_settings')
    if (old) localStorage.setItem(KEY, old)
    localStorage.setItem('anisaki:migrated', '1')
  }
} catch {
  /* nothing to bring over */
}

const { api } = await import('./api')
;(window as any).api = api

// A desktop app, not a web page: no browser menu on right click (Yenile, Farklı kaydet, Yazdır…) except
// in text boxes (cut / copy / paste), and no browser shortcuts that reload or save the page.
document.addEventListener('contextmenu', e => {
  if (!(e.target as HTMLElement | null)?.closest?.('input, textarea, [contenteditable="true"]')) e.preventDefault()
})
document.addEventListener('keydown', e => {
  const k = e.key.toLowerCase()
  if (k === 'f5' || k === 'f3' || k === 'f7' || ((e.ctrlKey || e.metaKey) && ['r', 'p', 's', 'u', 'f', 'g', 'j', 'h'].includes(k)) || (e.ctrlKey && e.shiftKey && ['i', 'c'].includes(k) && !import.meta.env.DEV)) e.preventDefault()
}, true)
