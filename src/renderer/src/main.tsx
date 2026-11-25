import './desktop/install'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { startI18n } from './lib/i18n'
import './styles.css'

startI18n()
createRoot(document.getElementById('root')!).render(<App />)
