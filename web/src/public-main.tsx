import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './index.css'
import { ThemeProvider } from '@/components/agndex/theme-provider'
import PublicHome from './public/PublicHome'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="dark" storageKey="xboard-theme">
      <PublicHome />
    </ThemeProvider>
  </StrictMode>,
)