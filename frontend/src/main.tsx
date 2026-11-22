import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { bootOffice } from './lib/roster'
import { applyTheme, parseThemeParam, prefersDark } from './lib/theme'
import './styles/global.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root tidak ada')

// Paint the OS-preferred theme before the first frame so there is no white
// flash; the office clock (from /api/status) takes over as soon as it answers.
const urlTheme = parseThemeParam(new URLSearchParams(window.location.search).get('theme'))
applyTheme(urlTheme === 'day' || urlTheme === 'night' ? urlTheme : prefersDark() ? 'night' : 'day', 'prefers-color-scheme')

// /api/config decides the title, timezone, teams and desks, so it is fetched
// before the first render: the scene must never paint a guessed roster and then
// jump. A failed fetch falls back to the seed roster in lib/agents.ts.
void bootOffice().finally(() => {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
