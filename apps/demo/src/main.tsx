import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@dotvoid/textbit-styles'
import './demo.css'
import { App } from './App'
import { FilmPage } from './film/FilmPage'

// /?film is the stage of the demo movie, see apps/agent-lab/film
const film = new URLSearchParams(location.search).has('film')
createRoot(document.getElementById('root')!).render(<StrictMode>{film ? <FilmPage /> : <App />}</StrictMode>)
