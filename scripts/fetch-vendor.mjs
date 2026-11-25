// Downloads the player binaries that are not kept in git:
//   vendor/mpv      mpv for Windows (shinchiro/mpv-winbuild-cmake build) + libmpv-2.dll (the app plays in-process)
//   vendor/ffmpeg   ffmpeg / ffprobe (from the ffmpeg-static / ffprobe-static packages)
//   vendor/anime4k  Anime4K GLSL shaders (bloc97/Anime4K, MIT)
// Usage: npm run vendor
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const MPV_URL = 'https://github.com/shinchiro/mpv-winbuild-cmake/releases/download/20261101/mpv-x86_64-20261101-git-48fca90e8c.7z'
const LIBMPV_URL = 'https://github.com/shinchiro/mpv-winbuild-cmake/releases/download/20261101/mpv-dev-x86_64-20261101-git-48fca90e8c.7z'
const ANIME4K_URL = 'https://github.com/bloc97/Anime4K/releases/download/v4.0.1/Anime4K_v4.0.zip'
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..')
const vendor = path.join(root, 'vendor')
// Windows' own tar (bsdtar) can read .7z and .zip.
const TAR = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')

async function fetchTo(url, file) {
  console.log('İndiriliyor:', url)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()))
}

async function install(name, url, check) {
  const dest = path.join(vendor, name)
  if (fs.existsSync(path.join(dest, check))) return console.log(`${name}: zaten var`)
  fs.mkdirSync(dest, { recursive: true })
  const tmp = path.join(os.tmpdir(), `anisaki-${name}${path.extname(url)}`)
  await fetchTo(url, tmp)
  execFileSync(TAR, ['-xf', tmp, '-C', dest])
  fs.rmSync(tmp)
  console.log(`${name}: hazır`)
}

await install('mpv', MPV_URL, 'mpv.exe')
if (!fs.existsSync(path.join(vendor, 'mpv', 'libmpv-2.dll'))) {
  const tmp = path.join(os.tmpdir(), 'anisaki-libmpv.7z')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anisaki-libmpv-'))
  await fetchTo(LIBMPV_URL, tmp)
  execFileSync(TAR, ['-xf', tmp, '-C', dir])
  fs.copyFileSync(path.join(dir, 'libmpv-2.dll'), path.join(vendor, 'mpv', 'libmpv-2.dll'))
  fs.rmSync(tmp)
  fs.rmSync(dir, { recursive: true, force: true })
  console.log('libmpv: hazır')
}
await install('anime4k', ANIME4K_URL, 'Anime4K_Clamp_Highlights.glsl')

// ffmpeg / ffprobe: subtitle extraction, seek-bar previews, audio for subtitle sync
fs.mkdirSync(path.join(vendor, 'ffmpeg'), { recursive: true })
for (const [from, to] of [['node_modules/ffmpeg-static/ffmpeg.exe', 'ffmpeg.exe'], ['node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe', 'ffprobe.exe']])
  if (!fs.existsSync(path.join(vendor, 'ffmpeg', to))) fs.copyFileSync(path.join(root, from), path.join(vendor, 'ffmpeg', to))
