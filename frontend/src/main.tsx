import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { TelemetryProvider } from './services/telemetry.tsx'
import { NotificationCenterProvider } from './services/notificationCenter.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TelemetryProvider>
      <NotificationCenterProvider>
        <App />
      </NotificationCenterProvider>
    </TelemetryProvider>
  </StrictMode>,
)
