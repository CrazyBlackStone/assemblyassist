# Assembly Assist: design and decisions

## Flow

Workspace (projects) → Setup (files, options, phone, order) → Build (rail · part · board · camera, voice bar) → Done (review every part).

## Where things live

| Feature | Code |
| --- | --- |
| Projects in IndexedDB, autosave, undo history | `src/state/projects.js` |
| Gerber unzip, render, CPL alignment | `src/lib/gerber/render.js` (tracespace) |
| Package geometry (pads, body, pin-1 / polarity mark) | `src/lib/bom/packages.js` |
| BOM/CPL parsing, polarity rules | `src/lib/bom/` |
| Order: categories, drag and drop | `src/lib/plan/plan.js`, `src/components/BomList.jsx` |
| Board render with placed / current parts | `src/components/BoardView.jsx` |
| Camera panel, calibration, check and review overlays | `src/components/CameraPanel.jsx`, `src/lib/verify/` |
| Voice: capture, speech-to-text, grammar, assistant | `src/lib/voice/`, `src/lib/ai/tasks/assistant.js` |
| Model config, keys, prices | `src/config/ai.js` |
| Provider layer, cost meter, failure log | `src/lib/ai/provider.js`, `src/state/logs.js`, `src/components/LogSheet.jsx` |

## Decisions

- **No AI settings in the app.** Models and keys are set in code and build environment only.
- **Gerbers drive the board view.** Tracespace renders the top side; the CPL is checked against the outline and re-centred (with a note) when it uses a different origin. Without Gerbers the outline comes from the parts.
- **Calibrated crops.** Two taps map board millimetres to camera pixels. Each check crops one part, sized to its footprint, from a full-resolution frame of the same video track, and rotates it to the reference orientation. The prompt then says where the mark must be ("top-left", "left").
- **Soldering check is a project setting.** With paste, the model is asked about placement and orientation only, and solder issues it reports anyway are dropped.
- **No all-clear.** The best result is "AI sees no problem — confirm with your own eyes"; the user taps Good or ✕.
- **Speech to text through a model**, with the board's ref des and category names passed as vocabulary hints. Simple commands are parsed locally. The language model only handles the rest, and it can only name parts that exist.
- **Removed in this version:** the Blocks page, tray mode, the "dropped it" button, multimeter checkpoints and the separate fix-help call. Soldering advice comes from the assistant, grounded in the technique library.
- **Instructor view:** not built. It needs the backend.

## Backend (EC2), when needed

1. A key proxy for `VITE_AI_PROXY_URL`, so no key ships to the browser.
2. A TURN relay (coturn) if campus Wi-Fi blocks WebRTC.
3. Login, cloud sync of projects, and the instructor view.

## Needed from the team

1. The course's models and budget, to set in `src/config/ai.js` (`TASKS`, `STT`, `PRICE_TABLE`).
2. Keys as repository secrets, with a spending limit.
3. A review of `src/data/techniques.json`, which is all draft.
4. 10–20 single-component photos for `test-set/`.
5. A real Gerber + BOM + CPL set from your CAD tool, to confirm the formats and the rotation convention.

## Known limits

- Orientation drawings and crops assume KiCad's zero-rotation convention; JLCPCB CPL rotations differ for some packages. The board silkscreen is the final authority.
- Through-hole headers are assumed to have their origin on pin 1 (KiCad). A CPL that uses the part centre shifts them by half the header.
- Bottom-side parts are listed but not drawn.
- The verification crop assumes the phone is roughly overhead; strong tilt needs a recalibration closer to the parts being checked.
