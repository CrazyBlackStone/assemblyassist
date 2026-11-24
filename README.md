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
- **Setup**: upload Gerber (.zip or files), BOM and CPL; turn the soldering check off for solder paste; choose camera and microphone; pair the phone by QR code; drag the BOM into the order you want, or ask for a suggested order.
- **Build**:
  - **Left rail**: the build order as ref des. Tap it to open the full list, where parts and whole categories can be dragged.
  - **Panel 1**: the current part with a drawing of its package as it sits on the board, the pin-1 or polarity mark lit, the next part, and Back / Skip / Next.
  - **Panel 2**: the board rendered from the Gerbers. Placed parts appear on it, and the current part hovers and lands when placed.
  - **Panel 3**: the phone camera. After **Next**, it blurs and shows the cropped part with the AI's orientation and solder verdict.
  - **Bottom bar**: what was heard, what the app answers, and a soldering tip for the current package.
  - **Done** (top right): re-checks every placed part from one photo, lighting each up on the board in turn.

Keyboard (works with a USB foot pedal): `Space` next · `S` skip · `Z` back · `K` check · `Y` confirm · hold `T` to talk.

Voice: *next, skip, back, C8 next, capacitors next, go to U2, where is C8, check, looks good, review*. Anything else, such as *"do the resistors before the LEDs"* or *"how do I fix a bridge?"*, goes to the language model, which can only act on parts and categories that exist on the board.

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

## Deploy

`.github/workflows/deploy.yml` tests, builds and deploys every push to `main`. Pages must be set to **Source: GitHub Actions**.

## Pairing

The phone opens the QR code's link and streams over WebRTC (PeerJS). If campus Wi-Fi blocks the connection, use the phone's hotspot ([docs/phone-hotspot.md](docs/phone-hotspot.md)), or set `VITE_ICE_SERVERS` to a TURN relay such as coturn on EC2.

## Privacy

Camera frames and crops stay in memory and are never stored; only the crop of the part being checked is sent to the model. Don't point the camera at confidential designs.
