import { useEffect } from 'react'
import { useHashRoute } from './lib/router.js'
import { useStore } from './lib/store.js'
import { session } from './state/session.js'
import { prefs } from './state/settings.js'
import { ui } from './state/ui.js'
import { startHost, onPhoneMessage } from './lib/pairing/pairing.js'
import { handleTranscript } from './lib/voice/controller.js'
import { Header } from './components/Header.jsx'
import { Setup } from './screens/Setup.jsx'
import { Build } from './screens/Build.jsx'
import { Blocks } from './screens/Blocks.jsx'
import { Log } from './screens/Log.jsx'
import { Phone } from './screens/Phone.jsx'

export default function App() {
  const [route, navigate] = useHashRoute()
  const hasBoard = useStore(session, (s) => Boolean(s.board))
  const cameraSource = useStore(prefs, (p) => p.cameraSource)
  const toast = useStore(ui, (u) => u.toast)
  const isPhone = route.path === '/phone'

  // The laptop keeps its pairing code alive on every screen, and routes phone transcripts to voice commands.
  useEffect(() => {
    if (isPhone || cameraSource !== 'phone') return
    startHost()
    return onPhoneMessage((msg) => {
      if (msg.type === 'transcript') handleTranscript(msg.text, msg.alternatives ?? [msg.text], 'phone')
    })
  }, [isPhone, cameraSource])

  if (isPhone) return <Phone code={route.params.code} />

  const path = ['/setup', '/build', '/blocks', '/log'].includes(route.path) ? route.path : hasBoard ? '/build' : '/setup'
  return (
    <div className="app">
      <Header route={path} navigate={navigate} />
      {path === '/setup' && <Setup navigate={navigate} />}
      {path === '/build' && <Build />}
      {path === '/blocks' && <Blocks navigate={navigate} />}
      {path === '/log' && <Log />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
