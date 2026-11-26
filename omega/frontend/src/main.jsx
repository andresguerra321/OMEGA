import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/sora/latin-300.css'
import '@fontsource/sora/latin-ext-300.css'
import '@fontsource/sora/latin-500.css'
import '@fontsource/sora/latin-ext-500.css'
import '@fontsource/sora/latin-600.css'
import '@fontsource/sora/latin-ext-600.css'
import '@fontsource/ibm-plex-sans/latin-400.css'
import '@fontsource/ibm-plex-sans/latin-ext-400.css'
import '@fontsource/ibm-plex-sans/latin-500.css'
import '@fontsource/ibm-plex-sans/latin-ext-500.css'
import '@fontsource/ibm-plex-sans/latin-600.css'
import '@fontsource/ibm-plex-sans/latin-ext-600.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-ext-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import '@fontsource/ibm-plex-mono/latin-ext-500.css'
import './index.css'
import { MotionConfig } from 'framer-motion'
import App from './App.jsx'
import { relayDesktopGoogleReturn } from './lib/googleAuth.js'

function GoogleDesktopReturn({ relay }) {
  const [message, setMessage] = useState('Enviando la autorización a OMEGA Desktop…')
  useEffect(() => {
    relay.then(
      () => setMessage('Vuelve a OMEGA Desktop para ver el resultado.'),
      () => setMessage('El intento venció o ya se usó. Vuelve a OMEGA Desktop e inténtalo de nuevo.'),
    )
  }, [relay])

  return (
    <main className="grid min-h-screen place-items-center bg-[#0A0A0C] p-5 text-white">
      <section className="w-full max-w-md rounded-2xl border border-white/[0.07] bg-[#0F131B]/85 p-6">
        <h1 className="text-xl font-semibold">Acceso con Google</h1>
        <p role="status" className="mt-2 text-sm text-zinc-300">{message}</p>
      </section>
    </main>
  )
}

// Auto-recuperación si se despliega una nueva compilación mientras la pestaña seguía abierta
if (typeof window !== 'undefined') {
  const recoverStaleChunk = () => {
    try {
      const last = Number(window.sessionStorage.getItem('omega_chunk_reload_ts') || 0)
      if (Date.now() - last < 15000) return
      window.sessionStorage.setItem('omega_chunk_reload_ts', String(Date.now()))
    } catch {
      // sessionStorage bloqueado
    }
    window.location.reload()
  }
  window.addEventListener('vite:preloadError', (event) => {
    event?.preventDefault?.()
    recoverStaleChunk()
  })
  window.addEventListener('unhandledrejection', (event) => {
    const msg = String(event?.reason?.message || event?.reason || '')
    if (msg.includes('Failed to fetch dynamically imported module') || msg.includes('Importing a module script failed')) {
      recoverStaleChunk()
    }
  })
}

const googleDesktopReturn = relayDesktopGoogleReturn()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      {googleDesktopReturn ? <GoogleDesktopReturn relay={googleDesktopReturn} /> : <App />}
    </MotionConfig>
  </StrictMode>,
)
