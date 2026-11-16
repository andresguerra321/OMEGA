import { StrictMode } from 'react'
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

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </StrictMode>,
)
