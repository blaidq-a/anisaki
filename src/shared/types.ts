// Types shared between the main process, preload and renderer.

export type DebridProvider = 'none' | 'realdebrid' | 'torbox'

export interface AddonManifest {
  id: string
  name: string
  version: string
  description?: string
  logo?: string
  types: string[]
  resources: (string | { name: string; types?: string[]; idPrefixes?: string[] })[]
  idPrefixes?: string[]
  behaviorHints?: { configurable?: boolean; configurationRequired?: boolean }
}

export interface InstalledAddon {
  /** Base URL, without the trailing /manifest.json */
  base: string
  manifest: AddonManifest
  enabled: boolean
}

/** A stream object as defined by the Stremio addon protocol. */
export interface StremioStream {
  name?: string
  title?: string
  description?: string
  url?: string
  infoHash?: string
  fileIdx?: number
  sources?: string[]
  externalUrl?: string
  behaviorHints?: { filename?: string; bingeGroup?: string; videoSize?: number; notWebReady?: boolean }
}

export interface AddonStreams {
  addon: string
  addonId: string
  streams: StremioStream[]
  error?: string
}

export interface LibraryEntry {
  id: number // AniList id
  title: string
  cover: string
  episodes: number | null
  status: 'watching' | 'plan' | 'done' | 'hold' | 'drop'
  progress: number
  score: number | null
  updated: number
}

export type Anime4KMode = 'off' | 'A' | 'B' | 'C' | 'A+A' | 'B+B' | 'C+A'

export interface PublicSettings {
  addons: InstalledAddon[]
  debridProvider: DebridProvider
  debridKeys: { realdebrid: boolean; torbox: boolean } // only whether a key is saved
  /** The TorBox key is the one built into this copy of the app */
  builtinDebrid: boolean
  anime4k: Anime4KMode
  /** mpv = embedded mpv (default), builtin = Chromium video element + ffmpeg helpers (fallback) */
  engine: 'mpv' | 'builtin'
  anime4kQuality: 'hq' | 'fast'
  /** Always ask OpenSubtitles for subtitles, even if the addon isn't installed */
  builtinSubs: boolean
  /** No Turkish subtitle anywhere → machine-translate the English one */
  autoTranslate: boolean
  /** Translate with the on-device model (downloaded once) instead of online services */
  localTranslate?: boolean
  mpvArgs: string
  localFolders: string[]
  /** Watch list of the active profile */
  library: Record<string, LibraryEntry>
  /** Preferred audio languages, main first then backup (ISO 639-1, e.g. ['ja', 'en']) */
  audioLangs: string[]
  /** Preferred subtitle languages, main first then backup (e.g. ['tr', 'en']) */
  subLangs: string[]
  /** Let the player pick the subtitle itself, checking online subtitles against the audio */
  autoSubs: boolean
  /** Mark an episode watched (and sync to AniList) after this share of it, 0..1 */
  watchedAt: number
  profiles: ProfileInfo[]
  activeProfile: string
  /** Profile the app opens with; null: ask every time ("Kim izliyor?") when there is more than one */
  startProfile: string | null
  /** Pick and start the best source automatically when an episode is clicked */
  autoSource: boolean
  /** Preferred resolution for automatic source selection */
  preferredQuality: '2160p' | '1080p' | '720p'
  /** AniList API client id the user registered (needed for login) */
  anilistClientId: string
  /** Use a subtitle that is inside the video file (any preferred language) before online or translated ones */
  preferEmbedded: boolean
  /** How torrent sources are opened: debrid only, straight torrent only, or debrid when cached else torrent */
  streamMode: 'auto' | 'debrid' | 'torrent'
  /** Upload limit while streaming a torrent, KB/s (0 = no limit) */
  torrentUploadLimit: number
  /** Keep downloaded torrent files after the player closes (otherwise deleted) */
  torrentKeep: boolean
  /** Color theme */
  theme: Theme
  /** Turn Anime4K off by itself for 4K (2160p) videos */
  anime4kOff4k: boolean
  /** Skip filler episodes when going to the next episode */
  skipFillers: boolean
  /** Unwatched episodes: picture blurred, title and summary hidden */
  hideSpoilers: boolean
  /** The user said not to warn again about a profile without AniList */
  noAccountWarn: boolean
}

export type Theme = 'grafit' | 'grafit-isik' | 'oled' | 'mono' | 'kagit' | 'sakura'
export const THEME_IDS: Theme[] = ['grafit', 'grafit-isik', 'oled', 'mono', 'kagit', 'sakura']

export interface ProfileInfo {
  id: string
  name: string
  avatar: string | null
  /** Linked AniList account, if any (the token itself never leaves the main process) */
  anilist: { userId: number; name: string; avatar: string | null } | null
  /** Linked MyAnimeList account, if any (token kept out of the page's settings) */
  mal?: { userId: number; name: string; avatar: string | null } | null
}

export interface LocalFile {
  path: string
  name: string
  size: number
  title: string
  episode: number | null
}

export interface ResolveRequest {
  infoHash: string
  fileIdx?: number
  filename?: string
  sources?: string[]
  /** Episode being played; used to pick (and verify) the file inside season packs */
  episode?: number
  /** The debrid service has it cached (instant) */
  cached?: boolean
}

/** Opening screen of the player while the source is being found */
export interface PlayerLoading {
  title: string
  subtitle?: string
  /** Background image (episode still or the anime's banner) */
  backdrop?: string | null
}

/** What the main window sends to the player overlay (functions can't cross windows). */
export interface PlayPayload {
  src: string
  title: string
  subtitle?: string
  animeId?: number
  malId?: number | null
  episode?: number
  episodes?: number | null
  cover?: string
  hasNext?: boolean
  hasPrev?: boolean
  /** Anime's first air year and aired episode count (for ranking sources in the player) */
  year?: number | null
  total?: number | null
  /** A later season of its show (source ranking prefers releases that name the season) */
  later?: boolean
  /** Start at this position (seconds), e.g. after switching the source */
  start?: number
  /** How the link was made (debrid / torrent): asked again for a fresh link when playback stalls */
  resolve?: ResolveRequest
  /** Titles for the name search of sources */
  searchTitles?: string[]
  /** Character names (AniList) kept as is by the machine translation */
  names?: string[]
  /** The main window can open another source for this episode (wrong file, broken audio…) */
  canRetry?: boolean
  /** Expected episode length in seconds (AniList), to spot a wrong file */
  expectedDuration?: number | null
  subIds?: { type: string; ids: string[] }
  source?: { addon: string; label: string; size?: string | null }
  /** Shown once when playback starts (e.g. "2 filler bölüm atlandı") */
  notice?: string
  /** The anime's episodes, for the episode list inside the player */
  episodeList?: { number: number; title: string | null; image: string | null; filler?: boolean }[]
}

export interface MediaTrack {
  /** Absolute stream index in the file */
  index: number
  /** Index among streams of the same type (what ffmpeg's 0:a:N / 0:s:N use) */
  rel: number
  codec: string
  lang: string | null
  title: string | null
  channels: number | null
  layout: string | null
  default: boolean
  forced: boolean
  /** Audio: the browser can decode it. Subtitles: text-based, so it can be rendered. */
  supported: boolean
}

export interface MediaInfo {
  container: string
  duration: number
  bitrate: number
  size: number
  video: {
    codec: string
    profile: string | null
    width: number
    height: number
    fps: number
    pixFmt: string | null
    hdr: 'HDR10' | 'HLG' | 'Dolby Vision' | null
    supported: boolean
  }
  audio: MediaTrack[]
  subtitles: MediaTrack[]
  hasFonts: boolean
}

/** A subtitle offered by a Stremio subtitles addon. */
export interface AddonSubtitle {
  id: string
  url: string
  lang: string
  addon: string
}

export interface ResolveProgress {
  stage: 'adding' | 'selecting' | 'downloading' | 'unrestricting' | 'ready'
  progress?: number
  message: string
}
