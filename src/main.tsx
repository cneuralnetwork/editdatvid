import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'flexlayout-react/style/dark.css'
import './styles.css'
import App from './App'

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then((registration) => registration.update()))
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
