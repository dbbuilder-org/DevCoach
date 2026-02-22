import React from 'react'
import ReactDOM from 'react-dom/client'
import { ClerkProvider } from '@clerk/clerk-react'
import StandaloneApp from './StandaloneApp'
import './theme.css'

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string

if (!publishableKey) {
  throw new Error('VITE_CLERK_PUBLISHABLE_KEY is not set')
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ClerkProvider publishableKey={publishableKey}>
      <StandaloneApp />
    </ClerkProvider>
  </React.StrictMode>
)
