import { useEffect, useState } from 'react'

// Hash routing (#/build) so the app works on GitHub Pages with no server-side rewrites.
function parse() {
  const raw = window.location.hash.replace(/^#/, '') || '/'
  const [path, query = ''] = raw.split('?')
  return { path, params: Object.fromEntries(new URLSearchParams(query)) }
}

export function useHashRoute() {
  const [route, setRoute] = useState(parse)
  useEffect(() => {
    const on = () => setRoute(parse())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  const navigate = (path) => {
    window.location.hash = path
  }
  return [route, navigate]
}
