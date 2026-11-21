import { useCallback, useEffect, useRef, useState } from 'react'
import { runTask, taskConfig } from './provider.js'

/**
 * React wrapper around runTask: loading state, cancel, and a `key` so a slow answer
 * for one part is never shown against another (stale results are dropped).
 */
export function useAiTask(task) {
  const [state, setState] = useState({ status: 'idle' })
  const ctrl = useRef(null)
  const runId = useRef(0)

  const run = useCallback(
    async ({ key, ...args }) => {
      ctrl.current?.abort()
      const controller = new AbortController()
      ctrl.current = controller
      const id = ++runId.current
      setState({ status: 'loading', key, timeoutMs: taskConfig(task).timeoutMs })
      const result = await runTask({ task, signal: controller.signal, ...args })
      if (id !== runId.current) return null // superseded or cancelled
      if (result.ok) setState({ status: 'done', key, ...result })
      else if (result.kind === 'cancelled') setState({ status: 'idle' })
      else setState({ status: 'error', key, ...result })
      return result
    },
    [task],
  )

  const cancel = useCallback(() => {
    runId.current++
    ctrl.current?.abort()
    setState({ status: 'idle' })
  }, [])

  const reset = cancel

  useEffect(() => () => ctrl.current?.abort(), [])

  return { ...state, run, cancel, reset }
}
