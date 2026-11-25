import { app, safeStorage } from 'electron'
import { builtinTorBoxKey } from './embedded'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { THEME_IDS, type DebridProvider, type LibraryEntry, type ProfileInfo, type PublicSettings } from '../shared/types'

/** A profile as stored on disk: its own watch list and (optionally) an AniList login. */
interface StoredProfile extends Omit<ProfileInfo, 'anilist' | 'mal'> {
  anilist: (NonNullable<ProfileInfo['anilist']> & { token: string }) | null
  /** token = sealed JSON { access, refresh, expires } */
  mal?: (NonNullable<ProfileInfo['mal']> & { token: string }) | null
  library: Record<string, LibraryEntry>
}

interface StoredSettings extends Omit<PublicSettings, 'debridKeys' | 'library' | 'profiles' | 'builtinDebrid'> {
  /** Encrypted with the OS keychain (DPAPI on Windows), base64. */
  debridKeys: { realdebrid?: string; torbox?: string }
  profiles: StoredProfile[]
}

const newProfile = (name: string, library: Record<string, LibraryEntry> = {}): StoredProfile => ({
  id: crypto.randomBytes(6).toString('hex'),
  name,
  avatar: null,
  anilist: null,
  library
})

const DEFAULTS = (): StoredSettings => {
  const p = newProfile('Profil 1')
  return {
    addons: [],
    debridKeys: {},
    // A copy with a built-in key works out of the box
    debridProvider: builtinTorBoxKey() ? 'torbox' : 'none',
    anime4k: 'A',
    engine: 'mpv',
    anime4kQuality: 'hq',
    builtinSubs: true,
    autoTranslate: true,
    localTranslate: false,
    mpvArgs: '',
    localFolders: [],
    audioLangs: ['ja', 'en'],
    subLangs: ['tr', 'en'],
    autoSubs: true,
    watchedAt: 0.8,
    autoSource: true,
    preferredQuality: '1080p',
    preferEmbedded: true,
    streamMode: 'auto',
    torrentUploadLimit: 300,
    torrentKeep: false,
    theme: 'grafit',
    anime4kOff4k: true,
    skipFillers: false,
    hideSpoilers: false,
    noAccountWarn: false,
    profiles: [p],
    activeProfile: p.id,
    startProfile: null,
    anilistClientId: ''
  }
}

const file = () => path.join(app.getPath('userData'), 'settings.json')
let cache: StoredSettings | null = null
// The text the cache was read from. The app's two windows (main and the player overlay) each run this code
// with their own cache: without checking, a window kept the settings it read when it opened, saved them
// back over the other window's changes (progress marked in the player was lost, the player didn't see a
// sync or a profile switch made in the main window). The stored text is read every time (cheap) and parsed
// again only when it changed.
let cacheRaw: string | null = null

export function load(): StoredSettings {
  let text: string | null = null
  try {
    text = fs.readFileSync(file(), 'utf8')
  } catch {
    text = null
  }
  if (cache && text === cacheRaw) return cache
  cacheRaw = text
  try {
    if (text == null) throw new Error('no settings yet')
    const raw = JSON.parse(text)
    // Older versions: external mpv settings, and one watch list without profiles.
    delete raw.player
    delete raw.mpvPath
    const base = DEFAULTS()
    if (!raw.profiles?.length) {
      raw.profiles = [{ ...base.profiles[0], library: raw.library ?? {} }]
      raw.activeProfile = raw.profiles[0].id
    }
    delete raw.library
    // Linked profiles still called "Profil N" take the AniList user name.
    for (const p of raw.profiles) if (p.anilist?.name && /^Profil \d+$/.test(p.name)) p.name = p.anilist.name
    cache = { ...base, ...raw }
    // Themes of older versions (accent colors only) → the new default
    if (!THEME_IDS.includes(cache!.theme)) cache!.theme = 'grafit'
  } catch {
    cache = DEFAULTS()
  }
  return cache!
}

export function save(patch: Partial<StoredSettings>): void {
  cache = { ...load(), ...patch }
  fs.mkdirSync(path.dirname(file()), { recursive: true })
  const text = JSON.stringify(cache, null, 2)
  fs.writeFileSync(file(), text)
  cacheRaw = text
}

/* --------------------------------- profiles -------------------------------- */
export function activeProfile(): StoredProfile {
  const s = load()
  return s.profiles.find(p => p.id === s.activeProfile) ?? s.profiles[0]
}

function updateProfile(id: string, patch: Partial<StoredProfile>) {
  save({ profiles: load().profiles.map(p => (p.id === id ? { ...p, ...patch } : p)) })
}

export function setLibrary(library: Record<string, LibraryEntry>) {
  updateProfile(activeProfile().id, { library })
}

export function addProfile(name: string): string {
  const p = newProfile(name.trim() || `Profil ${load().profiles.length + 1}`)
  save({ profiles: [...load().profiles, p], activeProfile: p.id })
  return p.id
}

export function removeProfile(id: string) {
  const s = load()
  if (s.profiles.length <= 1) throw new Error('Son profil silinemez.')
  const profiles = s.profiles.filter(p => p.id !== id)
  save({ profiles, activeProfile: s.activeProfile === id ? profiles[0].id : s.activeProfile, startProfile: s.startProfile === id ? null : s.startProfile })
}

export function switchProfile(id: string) {
  if (load().profiles.some(p => p.id === id)) save({ activeProfile: id })
}

export function renameProfile(id: string, name: string) {
  if (name.trim()) updateProfile(id, { name: name.trim() })
}

const seal = (v: string) => (safeStorage.isEncryptionAvailable() ? 'enc:' + safeStorage.encryptString(v).toString('base64') : 'raw:' + v)
const unseal = (v: string) => (v.startsWith('enc:') ? safeStorage.decryptString(Buffer.from(v.slice(4), 'base64')) : v.slice(4))

export function setAniList(id: string, account: { userId: number; name: string; avatar: string | null; token: string } | null) {
  updateProfile(id, {
    anilist: account ? { ...account, token: seal(account.token) } : null,
    // Use the AniList name/avatar for a profile that still has its default name.
    ...(account ? { avatar: account.avatar } : {}),
    ...(account && isDefaultName(id) ? { name: account.name } : {})
  })
}

export function setMal(id: string, account: { userId: number; name: string; avatar: string | null; token: { access: string; refresh: string; expires: number } } | null) {
  updateProfile(id, {
    mal: account ? { userId: account.userId, name: account.name, avatar: account.avatar, token: seal(JSON.stringify(account.token)) } : null,
    ...(account && !load().profiles.find(p => p.id === id)?.avatar ? { avatar: account.avatar } : {}),
    ...(account && isDefaultName(id) ? { name: account.name } : {})
  })
}

export function malToken(id = activeProfile().id): { access: string; refresh: string; expires: number } | null {
  const p = load().profiles.find(x => x.id === id)
  if (!p?.mal) return null
  try {
    return JSON.parse(unseal(p.mal.token))
  } catch {
    return null
  }
}

export function saveMalToken(id: string, token: { access: string; refresh: string; expires: number }) {
  const p = load().profiles.find(x => x.id === id)
  if (p?.mal) updateProfile(id, { mal: { ...p.mal, token: seal(JSON.stringify(token)) } })
}

/** "Profil 1", "Profil 2"… — the profile was never named by the user. */
function isDefaultName(id: string) {
  const p = load().profiles.find(x => x.id === id)
  return !p || /^Profil \d+$/.test(p.name)
}

export function aniListToken(id = activeProfile().id): string | null {
  const p = load().profiles.find(x => x.id === id)
  return p?.anilist ? unseal(p.anilist.token) : null
}

/* ------------------------------ public settings ------------------------------ */
export function publicSettings(): PublicSettings {
  const s = load()
  const active = activeProfile()
  return {
    ...s,
    library: active.library,
    activeProfile: active.id,
    profiles: s.profiles.map(({ library: _l, anilist, mal, ...p }) => ({ ...p, anilist: anilist ? { userId: anilist.userId, name: anilist.name, avatar: anilist.avatar } : null, mal: mal ? { userId: mal.userId, name: mal.name, avatar: mal.avatar } : null })),
    debridKeys: { realdebrid: !!s.debridKeys.realdebrid, torbox: !!s.debridKeys.torbox || !!builtinTorBoxKey() },
    builtinDebrid: !s.debridKeys.torbox && !!builtinTorBoxKey()
  }
}

export function setDebridKey(provider: Exclude<DebridProvider, 'none'>, key: string): void {
  const keys = { ...load().debridKeys }
  if (!key) delete keys[provider]
  else keys[provider] = seal(key)
  save({ debridKeys: keys })
}

export function getDebridKey(provider: Exclude<DebridProvider, 'none'>): string | null {
  const v = load().debridKeys[provider]
  if (v) return unseal(v)
  // No key of the user's own: the key built into this copy of the app, if any.
  return provider === 'torbox' ? builtinTorBoxKey() : null
}

/** The TorBox key in use is the built-in one (its account details are not shown). */
export const usingBuiltinKey = (provider: Exclude<DebridProvider, 'none'>) => provider === 'torbox' && !load().debridKeys.torbox && !!builtinTorBoxKey()
