# Assembly Assist

A browser app that guides hand assembly of a circuit board. A phone propped over the board streams its camera to the laptop. The app shows the next part and how it faces, renders the board from your Gerbers with every placed part on it, and has a vision model check each part's orientation (and its solder joints, unless you use paste) right after it is placed. Voice controls everything, so both hands can stay on the iron and tweezers. CS160 final project.

Live: https://crazyblackstone.github.io/assemblyassist/

## Run it

```bash
npm install
```

```bash
npm run dev
```

The workspace opens with a **Demo board** project (Gerbers, BOM and CPL included), so everything works with no uploads and no hardware.

```bash
npm test
```

## Screens

- **Workspace**: your projects, each with a board thumbnail and progress. Projects are stored in the browser (IndexedDB).
- **Setup**: drop the fabrication zip (or loose files) from any EDA tool, plus the CPL and an optional BOM; turn the soldering check off for solder paste; choose camera and microphone; pair the phone by QR code; drag the BOM into the order you want (front and back are ordered separately), or ask for a suggested order.
- **Build**:
  - **Left rail**: the build order as ref des. Tap it to open the full list, where parts and whole categories can be dragged.
  - **Panel 1**: the current part with a drawing of its package as it sits on the board, the pin-1 or polarity mark lit, the next part, and Back / Skip / Next.
  - **Panel 2**: the board in 3D, textured from the Gerbers, with every placed part as a model at its real size. The current part hovers and lands when placed, and the view flips to the back for back-side parts. Zoom with scroll or pinch, pan by dragging, tilt with a right-drag or two fingers, double-tap a part to zoom on it, or use the + / − / fit / flip buttons.
  - **Panel 3**: the phone camera. After **Next**, it blurs and shows the cropped part with the AI's orientation and solder verdict.
  - **Bottom bar**: what was heard, what the app answers, and a soldering tip for the current package.
  - **Done** (top right): re-checks every placed part from one photo, lighting each up on the board in turn.

Keyboard (works with a USB foot pedal): `Space` next · `S` skip · `Z` back · `K` check · `Y` confirm · hold `T` to talk.

Voice: *next, skip, back, C8 next, capacitors next, go to U2, where is C8, zoom in, zoom on C8, show the back, do the back first, check, looks good, review*. Anything else, such as *"do the resistors before the LEDs"* or *"how do I fix a bridge?"*, goes to the language model, which can only act on parts and categories that exist on the board.

## Supported files

| What | Formats |
| --- | --- |
| Gerbers | Any RS-274X/X2 set: KiCad, Altium/Protel (.GTL, .GBO, .GM1 …), Cadence Allegro/OrCAD (.art), Eagle (.cmp, .sol …). Layers are identified from the file's own header (Gerber X2 attributes, Allegro layer records) before the file name. Excellon drill files in any extension (.drl, .txt, .xln). Rout paths, inner layers, assembly and drill drawings are recognised and left out. |
| Placement (CPL) | KiCad .pos (CSV or ASCII), Altium pick-and-place (CSV or text), Allegro `place_txt`, JLCPCB CPL, generic CSV. Units mm, mil or inch. Bottom side from Layer/Side/TB or Allegro "mirror". |
| BOM | Optional. KiCad, Altium, JLCPCB or generic CSV. Without one, parts and packages come from the placement file. |
| Netlist | Optional IPC-D-356 (.ipc): gives the real pad layout of every part, used to size parts the package library doesn't know (connectors, modules). |

A fab zip can carry all of these; the app sorts them into the right slots.

## 3D models

Each part is drawn at its real size:
- **Chip resistors and capacitors:** every EIA size from 008004 to 2920 (imperial or metric codes). Capacitor thickness follows the value; for example an 0805 is 0.6 mm at 1 nF and 1.25 mm at 10 µF.
- **Tantalum and electrolytic capacitors:** tantalum case letters and EIA codes, and electrolytics by diameter and height.
- **Through-hole parts:** axial, disc, film-box and radial parts.
- **IPC-7351 footprint names:** names such as `RESC1608X55N` or `SOIC127P600X175-8N` encode the dimensions directly.
- **ICs and connectors:** SOIC, TSSOP, QFN, QFP, SOT and the usual connectors.
- **Unknown packages:** sized from the netlist's pads.

Footprints named `Library:Footprint` (KiCad) also load the real KiCad 3D model from the KiCad library (CC-BY-SA 4.0), served by jsDelivr. When there's no match, the built-in dimensioned model stays.

## AI

All model calls go through one provider layer (`src/lib/ai/provider.js`). Models, timeouts and prices are set in `src/config/ai.js`. Nothing about keys or models appears in the app.

| Call | Modality | What the app checks | When it fails |
| --- | --- | --- | --- |
| Speech to text | speech | n/a (shown, can be marked "misheard") | browser recognizer, then buttons |
| Placement check | image | low confidence never shows "no problem"; listed issues force "problem"; non-polarized parts can't be "flipped"; solder issues ignored when the check is off | "not checked"; check by eye |
| Voice assistant | language | every ref and category must exist; advice must cite a technique-library entry | "say that again" |
| Order suggestion | language | every part exactly once; invented parts removed | current order kept |

Every AI result carries an **AI** badge (**SIM** when simulated) and a thumbs-down that writes to the failure log. Timeouts, errors, unreadable answers and app corrections are logged automatically. The cost chip in the top bar is always visible, and opens the cost breakdown and failure log with JSON/CSV export.

### Keys

Keys are build-time environment variables (`.env.example` lists them):
- **Local development**: put them in `.env.local`.
- **GitHub Pages**: add repository secrets `OPENROUTER_API_KEY` (and optionally `OPENAI_API_KEY` for speech-to-text) under Settings → Secrets and variables → Actions; the deploy workflow passes them into the build.

With no key, AI calls run in simulated mode and speech uses the browser recognizer.

**Warning:** a key built into a public static site can be read by anyone who opens it. Set a spending limit on the key, or point `VITE_AI_PROXY_URL` at a small server (for example on the EC2 backend) that adds the key itself, so no key ships to the browser.

### Verification crops

After a two-tap camera calibration (tap two highlighted parts on the video), each check crops just that part from a full-resolution frame. The crop is sized to its footprint and rotated to the part's reference orientation, so the prompt can say exactly where the pin-1 or cathode mark must be. Without calibration, the user taps the part instead.

## Files the team owns

- `src/data/techniques.json`: the technique library and one-line tips per package family. All entries are drafts (`"reviewed": false`) until the hardware team checks them.
- `test-set/manifest.json` + `test-set/photos/`: close-up photos of single components. Run the accuracy test with:

```bash
OPENROUTER_API_KEY=sk-or-... npm run eval:vision
```

It reports verdict accuracy, orientation accuracy, missed flips and problems, false alarms and the can't-tell rate.

- `scripts/make-demo-gerbers.mjs` regenerates the demo board's Gerbers from its BOM/CPL.

Package dimensions live in `src/lib/bom/packages.js` (`CHIP_SIZES`, the height tables, `ipc7351`).

## Deploy

`.github/workflows/deploy.yml` tests, builds and deploys every push to `main`. Pages must be set to **Source: GitHub Actions**.

## Pairing

The phone opens the QR code's link and streams over WebRTC (PeerJS). If campus Wi-Fi blocks the connection, use the phone's hotspot ([docs/phone-hotspot.md](docs/phone-hotspot.md)), or set `VITE_ICE_SERVERS` to a TURN relay such as coturn on EC2.

## Privacy

Camera frames and crops stay in memory and are never stored; only the crop of the part being checked is sent to the model. Don't point the camera at confidential designs.
