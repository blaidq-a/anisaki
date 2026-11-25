// Stand-in for 'electron' when src/main code runs in the Tauri WebView.
// Settings live in the WebView's storage under the user's profile (see fs.ts).
export const app = { getPath: (_name?: string) => 'anisaki', getName: () => 'Anisaki' }
export const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: (s: string): { toString: (enc?: string) => string } => s,
  decryptString: (s: string | Uint8Array) => (typeof s === 'string' ? s : new TextDecoder().decode(s))
}
export default { app, safeStorage }
