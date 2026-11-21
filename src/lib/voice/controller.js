import { createStore } from '../store.js'
import { parseCommand, HELP_TEXT } from './grammar.js'
import { speak, sayRef, getLastSpoken } from './speech.js'
import { session, groupInfo, STATUS } from '../../state/session.js'
import { prefs } from '../../state/settings.js'
import { setUi, ui } from '../../state/ui.js'
import { describeLocation } from '../geometry/board.js'
import { MARKINGS } from '../bom/polarity.js'
import { sendToPhone } from '../pairing/pairing.js'

// Executes voice commands against the session. All answers come from board data.

export const voice = createStore({
  key: null,
  storage: null,
  initial: { heard: '', alternatives: [], interim: '', command: null, response: '', at: 0, listening: false, error: null },
})

const UNIT_WORDS = { p: 'pico', n: 'nano', u: 'micro', µ: 'micro', m: 'milli', k: 'kilo', M: 'mega' }

/** "100nF" -> "100 nanofarad", "4k7" -> "4 point 7 kilo-ohm". For speech only. */
export function spokenValue(part) {
  const v = String(part.value ?? '').trim()
  if (!v) return 'no value listed'
  const isR = /^R/i.test(part.ref)
  const m = /^(\d+(?:\.\d+)?)\s*([pnuµmkM])?(\d+)?\s*(F|H|Ω|ohm)?$/i.exec(v)
  if (!m) return v
  const [, num, prefix, tail, unit] = m
  const n = tail ? `${num} point ${tail}` : num
  const unitWord = unit ? (/f/i.test(unit) ? 'farad' : /h/i.test(unit) ? 'henry' : 'ohm') : isR ? 'ohm' : ''
  return `${n} ${prefix ? UNIT_WORDS[prefix] ?? prefix : ''}${unitWord}`.replace(/\s+/g, ' ').trim()
}

function describePart(s, ref) {
  const p = s.board.parts[ref]
  const g = groupInfo(s, ref)
  const tray = g.compartment ? ` From compartment ${g.compartment}.` : ''
  const pol = p.polarity.polarized ? ` Polarized: check the ${MARKINGS[p.polarity.marking].label.toLowerCase()} mark.` : ''
  return `${sayRef(ref)}, ${spokenValue(p)}, ${p.size.code || 'no package listed'}.${tray}${pol}`
}

function reply(text, command, heard, alternatives, source = 'local') {
  voice.set((v) => ({ ...v, heard, alternatives, interim: '', command, response: text, at: Date.now(), source }))
  const p = prefs.get()
  speak(text, { enabled: p.speakAloud, rate: p.voiceRate })
  const s = session.get()
  if (s.current) sendToPhone({ type: 'status', text: `${s.current}: ${s.board.parts[s.current].value}` })
}

export function setInterim(text) {
  voice.set((v) => ({ ...v, interim: text }))
}

/** Handle one final transcript (from this device's mic or the phone's). */
export function handleTranscript(transcript, alternatives = [transcript], source = 'local') {
  const s0 = session.get()
  if (!s0.board) return reply('Load a board first.', { type: 'unknown' }, transcript, alternatives, source)

  // Use the first alternative that parses to a known command.
  let cmd = { type: 'unknown' }
  let heard = transcript
  for (const alt of alternatives.length ? alternatives : [transcript]) {
    const c = parseCommand(alt, s0.board)
    if (c.type !== 'unknown') {
      cmd = c
      heard = alt
      break
    }
  }
  return reply(execute(cmd), cmd, heard, alternatives, source)
}

/** Run a command; returns the sentence to show and speak. Also used by buttons. */
export function execute(cmd) {
  const s = session.get()
  const ref = cmd.ref ?? s.current
  switch (cmd.type) {
    case 'placed':
    case 'skip': {
      if (!ref) return 'All parts are handled.'
      const part = s.board.parts[ref]
      if (cmd.type === 'placed' && part.polarity.polarized && !s.orientationOk[ref]) {
        return `${sayRef(ref)} is polarized. ${MARKINGS[part.polarity.marking].howTo} Then say confirm.`
      }
      session.dispatch({ type: 'mark', ref, status: cmd.type === 'placed' ? STATUS.placed : STATUS.skipped })
      const n = session.get().current
      const done = cmd.type === 'placed' ? 'placed' : 'skipped'
      return n ? `${sayRef(ref)} ${done}. Next: ${describePart(session.get(), n)}` : `${sayRef(ref)} ${done}. Every part is handled.`
    }
    case 'back': {
      const last = s.history[s.history.length - 1]
      if (!last) return 'Nothing to undo.'
      session.dispatch({ type: 'undo' })
      return `Undid ${last.label.replace(/^([A-Z]+)(\d+)/, (m) => sayRef(m))}. Now on ${sayRef(session.get().current ?? '')}.`
    }
    case 'jump':
      session.dispatch({ type: 'jump', ref })
      return `Showing ${describePart(session.get(), ref)}`
    case 'where': {
      if (!ref) return 'Which part? Say for example: where is C 8.'
      setUi({ highlightRef: ref })
      setTimeout(() => ui.get().highlightRef === ref && setUi({ highlightRef: null }), 8000)
      return describeLocation(s.board, ref, groupInfo(s, ref).compartment).replace(ref, sayRef(ref))
    }
    case 'where-value': {
      return cmd.groups
        .map((g) => {
          const left = g.refs.filter((r) => s.status[r] !== STATUS.placed)
          const comp = s.tray[g.id]
          return `${g.value}: ${comp ? `compartment ${comp}` : 'no tray compartment assigned'}. ${left.length} of ${g.refs.length} still to place.`
        })
        .join(' ')
    }
    case 'value':
      return ref ? describePart(s, ref) : 'No current part.'
    case 'orientation': {
      if (!ref) return 'No current part.'
      const p = s.board.parts[ref]
      if (!p.polarity.polarized) return `${sayRef(ref)} is not polarized. Either way round is fine.`
      return `${sayRef(ref)}: ${MARKINGS[p.polarity.marking].howTo}`
    }
    case 'confirm': {
      if (!ref) return 'Nothing to confirm.'
      const p = s.board.parts[ref]
      if (p.polarity.polarized && !s.orientationOk[ref]) {
        session.dispatch({ type: 'confirm-orientation', ref })
        return `Orientation of ${sayRef(ref)} confirmed. Solder it, then say next or check this.`
      }
      return 'Nothing waiting for confirmation. To confirm a check result, tap the button on screen.'
    }
    case 'dropped': {
      if (!ref) return 'Which part did you drop?'
      session.dispatch({ type: 'dropped', ref })
      const g = groupInfo(session.get(), ref)
      if (!s.board.hasSparesColumn) return `${sayRef(ref)} needs a replacement. This BOM does not list spares; use another ${spokenValue(s.board.parts[ref])} part.`
      return g.sparesLeft >= 0
        ? `${sayRef(ref)} needs a replacement. The BOM lists ${g.spares} spare${g.spares === 1 ? '' : 's'} for ${g.group.value}; ${g.sparesLeft} left.`
        : `${sayRef(ref)} needs a replacement, but the BOM's ${g.spares} spares for ${g.group.value} are used up.`
    }
    case 'check':
      if (ref && s.board.parts[ref].polarity.polarized && !s.orientationOk[ref]) {
        return `Confirm the orientation of ${sayRef(ref)} first. Say confirm.`
      }
      setUi({ checkRequest: Date.now() })
      return `Checking ${sayRef(ref)}. Tap the part on the live view to crop it.`
    case 'repeat':
      return getLastSpoken() || 'Nothing to repeat.'
    case 'help':
      return HELP_TEXT
    default:
      return 'Sorry, I did not catch a command. Say help for the list.'
  }
}

/** Buttons call this so tapping and speaking behave identically and both are announced. */
export function runCommand(cmd, { announce = true } = {}) {
  const text = execute(cmd)
  if (announce) reply(text, cmd, '(button)', [])
  return text
}
