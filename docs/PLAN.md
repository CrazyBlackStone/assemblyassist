# Assembly Assist: plan and decisions

## Status against the brief

| Brief item | Where |
| --- | --- |
| Smart BOM: upload BOM CSV + optional PnP, bundled demo, current-part card, progress, placed/skipped, one-tap undo, grouped by value, jump to any part, persists on refresh | `src/lib/bom/`, `src/state/session.js`, `src/screens/Build.jsx` |
| Build plan (language), reorderable blocks, AI label | `src/lib/ai/tasks/buildPlan.js`, `src/screens/Blocks.jsx` |
| Voice: push-to-talk, hands-free, transcript always shown, answers aloud and on screen | `src/lib/voice/`, `src/components/VoiceBar.jsx`, phone page |
| Orientation diagram + spoken guidance; confirm before placing/checking polarized parts | `src/lib/bom/polarity.js`, `src/components/Diagrams.jsx` |
| Magnified live view: zoom slider, tap-to-zoom, overlay on the current part (2-tap calibration), large text | `src/components/LiveView.jsx` |
| Phone pairing by QR / code; phone-only mode | `src/lib/pairing/pairing.js`, `src/screens/Phone.jsx` |
| Cropped vision check with context, verdict + confidence + issue, never "all clear", can't-tell as a first-class result | `src/lib/ai/tasks/visionCheck.js`, `src/components/CheckPanel.jsx` |
| Fix help from a curated technique library, with the source entry shown | `src/data/techniques.json`, `src/lib/ai/tasks/fixHelp.js`, `src/components/FixHelp.jsx` |
| Multimeter checkpoint per block | Build banner + Blocks screen |
| Dropped part + spares | `dropped` action, voice "I dropped it" |
| Tray mode | Blocks screen, voice "where are the 100nF" |
| Provider layer, timeouts, loading states, cost meter (unknown ≠ $0), failure log + export | `src/lib/ai/provider.js`, `src/config/models.js`, `src/state/logs.js`, `src/screens/Log.jsx` |
| Photos not stored; confidentiality warning | camera/check code keeps images in memory only; warnings on Setup, live view, phone page |
| Vision test script | `scripts/eval-vision.mjs`, `test-set/manifest.json` |
| Instructor view (optional) | Not built. Needs a backend: see below |

## Decisions

- **Plain JavaScript + Vite + React**, no router library (hash routing for GitHub Pages).
- **AI never decides facts about parts.** Polarity, package sizes, locations, values, spares and tray numbers come from the loaded files and fixed rules. Model outputs that name parts are checked against the board; unknown parts are removed and logged.
- **The vision check uses a full-resolution still, not the video stream.** The laptop asks the phone for a photo (ImageCapture where available) and crops it. If that fails it falls back to a video frame and says so.
- **Local quality check before spending a call:** the app measures brightness and blur on the crop and warns; the user can still send it.
- **Simulated provider** so the whole app can be demoed and tested without a key. Its results are labeled "Simulated AI", say "no model was called" and cost $0.
- **Voice commands are matched against a fixed grammar.** Matching is faster than a model call and costs nothing, and every answer traces to board data. The course's model-call requirement is met by plan (language), check (image) and fix help (language).
- **"Next" by voice means "placed, go to next".** "Back" is undo. Polarized parts refuse "next" until the orientation is confirmed.

## Backend (AWS EC2): not needed yet

Nothing required depends on a server: keys stay in the browser by requirement, progress is local, photos must not be stored, and pairing works through the public PeerJS server. Planned uses for EC2, in order:

1. **TURN relay (coturn)** if campus Wi-Fi blocks phone–laptop WebRTC. Configure in Setup; no code change.
2. **Own PeerServer** if the public one is unreliable. Also configured in Setup.
3. **Login + cloud sync + instructor view.** `src/lib/store.js` is the single persistence point to extend; the instructor view would aggregate `session.checks`, `blockChecks` and the failure log per learner.

## Needed from the team

1. Course model list and budget → update `DEFAULT_TASKS` and `PRICE_TABLE` in `src/config/models.js`.
2. Review the technique library (`src/data/techniques.json`, all marked draft).
3. 10–20 test photos + `test-set/manifest.json` entries, then run `npm run eval:vision`.
4. A real BOM/PnP export from your CAD tool to confirm the column aliases (KiCad, Altium, JLCPCB are covered).

## Known limits

- Orientation drawings assume the KiCad zero-rotation convention; other CAD tools may differ by 90°/180°. The UI says the silkscreen is the final authority.
- Web Speech recognition needs Chrome/Edge (or Safari on iOS); Firefox falls back to buttons and keys.
- The default free OpenRouter model ids may be retired; Setup auto-picks a free model with the right input type when that happens.
