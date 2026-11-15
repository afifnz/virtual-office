import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { bootOffice } from './lib/roster'
import './styles/global.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root tidak ada')

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
