// Imported first by main.tsx: the UI modules read this flag while they load (imports run before the code
// below them in main.tsx, so setting it there was too late and the phone-only settings never showed).
;(window as any).ANISAKI_MOBILE = true
if (!/AnisakiTV/.test(navigator.userAgent)) document.documentElement.classList.add('mobile')
