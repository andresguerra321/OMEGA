import { StrictMode, Suspense, lazy, useEffect, useState } from 'react'
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

const App = lazy(() => import('./App.jsx'))
const OmegaLandingPage = lazy(() => import('./components/OmegaLandingPage.jsx'))

function isLandingRoute() {
  if (typeof window === 'undefined') return false
  const path = window.location.pathname.replace(/\/+$/, '') || '/'
  if (path === '/landing' || path === '/presentacion') return true
  const params = new URLSearchParams(window.location.search)
  return params.get('landing') === '1'
}

export function RootEntry() {
  const [showLanding, setShowLanding] = useState(() => isLandingRoute())

  useEffect(() => {
    const onPopState = () => setShowLanding(isLandingRoute())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  function handleEnterApp(intent = 'login') {
    const nextUrl = intent === 'register' ? '/?auth=register' : '/'
    if (typeof window !== 'undefined' && window.history?.pushState) {
      window.history.pushState({}, '', nextUrl)
    }
    setShowLanding(false)
  }

  return (
    <MotionConfig reducedMotion="user">
      <Suspense fallback={<div className="h-screen w-screen bg-[#05070B]" />}>
        {showLanding ? <OmegaLandingPage onEnterApp={handleEnterApp} /> : <App />}
      </Suspense>
    </MotionConfig>
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

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <RootEntry />
  </StrictMode>,
)
