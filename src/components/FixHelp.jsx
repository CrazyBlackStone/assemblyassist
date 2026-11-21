import { useEffect, useState } from 'react'
import * as Fix from '../lib/ai/tasks/fixHelp.js'
import { ISSUE_LABELS } from '../lib/ai/tasks/visionCheck.js'
import { useAiTask } from '../lib/ai/useAiTask.js'
import { AiResult, AiLoading, AiError } from './Ai.jsx'
import { speak } from '../lib/voice/speech.js'
import { prefs } from '../state/settings.js'

/** Fix steps chosen and adapted from the curated technique library; every step cites its entry. */
export function FixHelp({ ctx, issue }) {
  const ai = useAiTask(Fix.TASK)
  const [open, setOpen] = useState(null)
  const key = `${ctx.ref}:${issue.type}:${issue.where}`

  const run = () =>
    ai.run({
      key,
      messages: Fix.buildMessages(ctx, issue),
      simulate: () => Fix.simulate(ctx, issue),
      validate: (v) => Fix.validate(issue.type, v),
      inputSummary: Fix.inputSummary(ctx, issue),
      fallbackAction: 'Showed the matching technique library entries unchanged.',
    })

  useEffect(() => {
    ai.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const say = (d) => {
    const p = prefs.get()
    speak([...d.steps.map((s, i) => `Step ${i + 1}. ${s.text}`), `Check: ${d.check}`].join(' '), { enabled: true, rate: p.voiceRate })
  }

  return (
    <section className="fix-help">
      <h3>Fix: {ISSUE_LABELS[issue.type]}</h3>
      {ai.status === 'idle' && (
        <button className="btn primary" onClick={run}>
          Get fix steps for {ctx.ref}
        </button>
      )}
      {ai.status === 'loading' && <AiLoading label="Choosing steps from the technique library…" timeoutMs={ai.timeoutMs} onCancel={ai.cancel} />}
      {ai.status === 'error' && (
        <>
          <AiError kind={ai.kind} error={ai.error} onRetry={run} fallbackText="Here are the library entries for this problem, unchanged:" />
          <LibraryEntries entries={Fix.candidatesFor(issue.type)} />
        </>
      )}
      {ai.status === 'done' && ai.key === key && (
        <AiResult
          meta={ai.meta}
          title={`Fix steps for ${ctx.ref}`}
          feedback={{
            task: Fix.TASK,
            inputSummary: Fix.inputSummary(ctx, issue),
            modelSaid: ai.data.steps.map((s) => `[${s.entryId}] ${s.text}`).join(' | '),
            uiAction: `Showed ${ai.data.steps.length} steps citing ${ai.data.entryIds.join(', ')}.`,
            corrections: ['Wrong technique', 'Steps unclear', 'Unsafe or misleading', 'Not for this part'],
          }}
        >
          <ol className="fix-steps">
            {ai.data.steps.map((s, i) => (
              <li key={i}>
                {s.text}{' '}
                <button className="source-chip" onClick={() => setOpen(open === s.entryId ? null : s.entryId)} title="Show the library entry">
                  from: {Fix.entryById(s.entryId).title}
                </button>
              </li>
            ))}
          </ol>
          <p className="fix-check">
            <strong>Check:</strong> {ai.data.check}{' '}
            <span className="source-chip">from: {Fix.entryById(ai.data.checkEntryId).title}</span>
          </p>
          {ai.data.entryIds.map((id) => Fix.entryById(id).caution && <p key={id} className="warn-text">⚠ {Fix.entryById(id).caution}</p>)}
          <div className="row">
            <button className="btn small" onClick={() => say(ai.data)}>
              🔊 Read aloud
            </button>
          </div>
          {open && <LibraryEntries entries={[Fix.entryById(open)]} />}
        </AiResult>
      )}
      <p className="muted small">Then use the multimeter to confirm the fix before moving on.</p>
    </section>
  )
}

export function LibraryEntries({ entries }) {
  return (
    <div className="library">
      {entries.map((e) => (
        <article key={e.id} className="library-entry">
          <header>
            <span className="lib-tag">Technique library</span> <strong>{e.title}</strong> <code>{e.id}</code>
            {!e.reviewed && <span className="draft-tag">draft, not yet reviewed by the team</span>}
          </header>
          <ol>
            {e.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          <p>
            <strong>Check:</strong> {e.check}
          </p>
          {e.caution && <p className="warn-text">⚠ {e.caution}</p>}
        </article>
      ))}
    </div>
  )
}
