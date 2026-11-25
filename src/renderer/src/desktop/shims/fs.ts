// Stand-in for 'node:fs' for the src/main code that runs in the WebView (only settings.json is used):
// files are localStorage entries.
const key = (p: string) => 'fs:' + p
export function readFileSync(p: string): string {
  const v = localStorage.getItem(key(p))
  if (v == null) throw new Error('ENOENT ' + p)
  return v
}
export function writeFileSync(p: string, data: string) {
  localStorage.setItem(key(p), String(data))
}
export const existsSync = (p: string) => localStorage.getItem(key(p)) != null
export function mkdirSync() {}
export default { readFileSync, writeFileSync, existsSync, mkdirSync }
