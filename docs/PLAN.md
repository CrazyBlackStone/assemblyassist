# Assembly Assist: design and decisions

## Flow

Workspace (projects) → Setup (files, options, phone, order) → Build (rail · part · board · camera, voice bar) → Done (review every part).

## Where things live

| Feature | Code |
| --- | --- |
| Projects in IndexedDB, autosave, undo history | `src/state/projects.js` |
| Layer identification (X2, Allegro, Altium, KiCad, Eagle) | `src/lib/gerber/identify.js` |
| Gerber unzip, render (top and bottom), CPL alignment | `src/lib/gerber/render.js` (tracespace) |
| Placement formats, units, BOM-less boards | `src/lib/bom/board.js` |
| IPC-356 netlist pads | `src/lib/bom/ipc356.js` |
| Package geometry, sizes, heights, IPC-7351 names | `src/lib/bom/packages.js` |
| 3D board (three.js), zoom, KiCad models | `src/components/BoardView3D.jsx` |
| BOM/CPL parsing, polarity rules | `src/lib/bom/` |
| Order: categories, drag and drop | `src/lib/plan/plan.js`, `src/components/BomList.jsx` |
| Camera panel, calibration, check and review overlays | `src/components/CameraPanel.jsx`, `src/lib/verify/` |
| Voice: capture, speech-to-text, grammar, assistant | `src/lib/voice/`, `src/lib/ai/tasks/assistant.js` |
| Model config, keys, prices | `src/config/ai.js` |
| Provider layer, cost meter, failure log | `src/lib/ai/provider.js`, `src/state/logs.js`, `src/components/LogSheet.jsx` |

## Decisions

- **No AI settings in the app.** Models and keys are set in code and build environment only.
- **Front and back.** Each category belongs to one side; the build does one side, then asks you to flip the board. The back goes first only when it has nothing but low SMD parts and the front has something tall. Camera calibration is kept per side.
- **Files are identified by content.** Tools name layers differently (Allegro `TOP.art`, Altium `.GTL`, KiCad `-F_Cu.gbr`), so headers come first and names second.
- **3D sizes come from data, not guesses.** Package names are parsed (EIA codes, IPC-7351, KiCad names) and heights come from datasheet tables. Unknown packages use the netlist's real pads.
- **Gerbers drive the board view.** Tracespace renders both sides as textures for the 3D board; the CPL is checked against the outline and re-centred (with a note) when it uses a different origin. Without Gerbers the outline comes from the parts.
- **Calibrated crops.** Two taps map board millimetres to camera pixels. Each check crops one part, sized to its footprint, from a full-resolution frame of the same video track, and rotates it to the reference orientation. The prompt then says where the mark must be ("top-left", "left").
- **Soldering check is a project setting.** With paste, the model is asked about placement and orientation only, and solder issues it reports anyway are dropped.
- **No all-clear.** The best result is "AI sees no problem — confirm with your own eyes"; the user taps Good or ✕.
- **Speech to text through a model**, with the board's ref des and category names passed as vocabulary hints. Simple commands are parsed locally. The language model only handles the rest, and it can only name parts that exist.
- **Removed in this version:** the Blocks page, tray mode, the "dropped it" button, multimeter checkpoints and the separate fix-help call. Soldering advice comes from the assistant, grounded in the technique library.
- **Instructor view:** not built. It needs the backend.

## Downloading 3D models (STEP)

What exists and what a browser can use:

| Source | What | Browser can fetch? |
| --- | --- | --- |
| KiCad 3D library (gitlab.com/kicad/libraries/kicad-packages3D) | STEP for every standard footprint, named like the footprint | No: GitLab sends no CORS header. Needs a server. |
| KiCad GitHub mirror via jsDelivr | Older snapshot, STEP and VRML (.wrl) | **Yes** (CORS allowed). Used now for `Library:Footprint` names. |
| LCSC / EasyEDA component API | 3D model (OBJ and STEP) by LCSC part number, e.g. from a JLCPCB BOM | No CORS: needs the EC2 server as a go-between. Unofficial API. |
| Manufacturer sites (Hirose, Molex, TI …) | Exact STEP per part number | Usually behind a login; manual download. |
| SnapEDA, Ultra Librarian, SamacSys (Mouser / DigiKey) | STEP by part number | Account and licence terms; API keys for automation. |

STEP is a CAD format; showing it in a browser needs OpenCASCADE compiled to WebAssembly (`occt-import-js`, about 7 MB), so the app uses VRML from the KiCad mirror for now. Every model falls back to the built-in dimensioned model when nothing is found.

## Backend (EC2), when needed

1. A key proxy for `VITE_AI_PROXY_URL`, so no key ships to the browser. The same server could fetch STEP models from the current KiCad library and LCSC by part number.
2. A TURN relay (coturn) if campus Wi-Fi blocks WebRTC.
3. Login, cloud sync of projects, and the instructor view.

## Needed from the team

1. The course's models and budget, to set in `src/config/ai.js` (`TASKS`, `STT`, `PRICE_TABLE`).
2. Keys as repository secrets, with a spending limit.
3. A review of `src/data/techniques.json`, which is all draft.
4. 10–20 single-component photos for `test-set/`.
5. An Altium export (Gerbers + pick-and-place), to confirm that path the way the Allegro example confirmed Allegro.

## Known limits

- Orientation drawings and crops assume KiCad's zero-rotation convention; JLCPCB CPL rotations differ for some packages. The board silkscreen is the final authority.
- Through-hole headers are assumed to have their origin on pin 1 (KiCad). A CPL that uses the part centre shifts them by half the header.
- Bottom-side placement assumes the KiCad/Allegro convention (footprint mirrored left–right). The netlist, when present, gives exact pads either way.
- The verification crop assumes the phone is roughly overhead; strong tilt needs a recalibration closer to the parts being checked.
