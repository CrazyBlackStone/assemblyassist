import { useEffect, useState } from 'react'
import { useHashRoute } from './lib/router.js'
import { useStore } from './lib/store.js'
import { project, openProject, loadWorkspace } from './state/projects.js'
import { ui } from './state/ui.js'
import { onPhoneMessage, configurePhone, startHost } from './lib/pairing/pairing.js'
import { handleClip, handleUtterance } from './lib/voice/controller.js'
import { ensureDemo } from './lib/projects/load.js'
import { refreshCatalog } from './lib/ai/catalog.js'
import { Workspace } from './screens/Workspace.jsx'
import { Setup } from './screens/Setup.jsx'
import { Build } from './screens/Build.jsx'
import { Phone } from './screens/Phone.jsx'
import { LogSheet } from './components/LogSheet.jsx'

export default function App() {
  const [route, navigate] = useHashRoute()
  const p = useStore(project)
  const toast = useStore(ui, (u) => u.toast)
  const [ready, setReady] = useState(false)
  const isPhone = route.path === '/phone'
  const m = /^\/p\/([^/]+)\/(setup|build)$/.exec(route.path)
  const projectId = m?.[1]
  const page = m?.[2] ?? 'workspace'

  useEffect(() => {
    if (isPhone) return
    loadWorkspace()
      .then(ensureDemo)
      .finally(() => setReady(true))
    refreshCatalog()
  }, [isPhone])

  // Each page opens at the top, not at the previous page's scroll position.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [route.path])

  useEffect(() => {
    if (projectId) openProject(projectId).then((x) => !x && navigate('/'))
    else project.set(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  // Laptop side of the phone link: keep pairing alive, route the phone's microphone.
  const usesPhone = p?.settings.cameraSource === 'phone' || p?.settings.micSource === 'phone'
  useEffect(() => {
    if (isPhone || !usesPhone) return
    startHost()
    configurePhone({ mic: p.settings.micSource })
    return onPhoneMessage((msg) => {
      if (msg.type === 'audio') handleClip(new Blob([msg.data], { type: 'audio/wav' }), msg.seconds ?? 2)
      if (msg.type === 'transcript') handleUtterance(msg.text)
    })
  }, [isPhone, usesPhone, p?.settings.micSource])

  if (isPhone) return <Phone code={route.params.code} />
  if (!ready) return null

  return (
    <>
      {page === 'workspace' && <Workspace navigate={navigate} />}
      {page === 'setup' && p?.id === projectId && <Setup navigate={navigate} />}
      {page === 'build' && p?.id === projectId && <Build navigate={navigate} />}
      <LogSheet />
      {toast && <div className="toast glass">{toast}</div>}
    </>
  )
}
