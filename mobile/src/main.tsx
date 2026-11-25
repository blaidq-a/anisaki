// Phone / TV entry: install the phone's window.api, then start the desktop UI with phone styles on top
// (and remote-control navigation on a TV).
import './flag'
import { api, isTv } from './api'
;(window as any).api = api
import { createRoot } from 'react-dom/client'
import '../../src/renderer/src/styles.css'
import './mobile.css'
import { App } from '../../src/renderer/src/App'
import { startI18n } from '../../src/renderer/src/lib/i18n'
import { startTvNavigation } from './tv'

// a TV gets the desktop layout (wide screen, remote control); the phone styles are for phones only
document.documentElement.classList.toggle('mobile', !isTv)
if (isTv) {
  document.documentElement.classList.add('tv')
  startTvNavigation()
}
startI18n()
createRoot(document.getElementById('root')!).render(<App />)
