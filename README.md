# Assembly Assist

A browser app that guides a person through hand-assembling a circuit board: a smart BOM that tracks which parts are placed, voice control, orientation diagrams for polarized parts, a magnified live view from a phone camera, and an AI check of each joint after soldering. CS160 final project.

It runs with **no API key and no hardware**: load the demo board, and AI features answer in a clearly labeled *simulated* mode until you add a key.

## Run it

```bash
npm install
```

```bash
npm run dev
```

Open the printed URL, then **Setup → Use the demo board**.

```bash
npm test
```

## Deploy (GitHub Pages)

`.github/workflows/deploy.yml` tests, builds and deploys on every push to `main`. One-time setup: in the GitHub repo go to **Settings → Pages → Source: GitHub Actions**. The site appears at `https://<owner>.github.io/<repo>/`. The app uses hash routing (`#/build`) and relative asset paths, so it works from any sub-path without configuration.

Phones only allow camera and microphone on HTTPS, so pair the phone with the deployed site (GitHub Pages is HTTPS), not with `http://<laptop-ip>:5173`.

## Use it

| Screen | What it does |
| --- | --- |
| **Setup** | Load the demo board or upload a BOM CSV (+ optional pick-and-place). Pick camera source and pair the phone by QR code. Enter an API key and choose models. |
| **Build** | Big current-part card, progress, orientation diagram, live view with zoom, board map, check panel, voice bar. |
| **Blocks** | Build plan (rule-based or AI), reorder blocks, multimeter checkpoints, tray compartments. |
| **Log** | Cost per call type, failure log, exports (JSON/CSV). |

Keyboard (works with a USB foot pedal that sends keys): `Space` placed · `S` skip · `Z` undo · `O` confirm orientation · `K` check · `D` dropped · `T` push-to-talk · `←/→` previous/next.

Voice: *next, skip, back, where is C8, where are the 100 nanofarad, what value is this, which way, confirm, check this, I dropped it, repeat, help.* The transcript and how it was understood are always shown.

## The three AI calls

All go through one provider layer (`src/lib/ai/provider.js`). Swap models in `src/config/models.js` or on the Setup screen.

| Call | Modality | Input | The app checks the output by… | When it fails |
| --- | --- | --- | --- | --- |
| Build plan | language | BOM + positions | every part exactly once; invented parts removed | rule-based order stays |
| Solder check | image | cropped photo + BOM context | enum verdicts; low-confidence "looks right" → "can't tell" | check by eye |
| Fix help | language | issue + technique library entries | every step must cite a real library entry | show library entries as written |

Speech in and out use the browser's built-in Web Speech API. Voice commands are matched by a fixed grammar, so answers come straight from the board data.

Every AI output is shown through one component (`AiResult`) that adds the AI-generated label, model, time, cost, and the *helpful* / *mark as wrong* buttons. Timeouts, errors, unreadable output and app corrections are logged to the failure log automatically.

## Files the team owns

- `src/data/techniques.json`: the technique library. Fix help can only choose and adapt these entries. The seed entries are drafts (`"reviewed": false`, shown as "draft" in the UI); the hardware team should review them and set `reviewed: true`.
- `test-set/manifest.json` + `test-set/photos/`: photos for the vision accuracy test. Run it with:

```bash
OPENROUTER_API_KEY=sk-or-... npm run eval:vision
```

It writes `test-set/results/<time>.csv/.json` and prints verdict accuracy, missed problems (the safety number), false alarms and the can't-tell rate. `npm run eval:vision -- --dry-run` checks the script without a key.

## Pairing and the optional EC2 relay

Pairing uses PeerJS (WebRTC). By default it uses the free PeerJS cloud server and Google's public STUN server. If campus Wi-Fi blocks the direct phone–laptop connection, the app says so. The fix is a TURN relay (for example coturn on EC2), entered under **Setup → Camera → connection settings → ICE servers**; no code change or rebuild needed. A self-hosted PeerServer can be entered in the same place. Until then, the quickest workaround is the phone's own hotspot: see [docs/phone-hotspot.md](docs/phone-hotspot.md).

## Privacy

Photos stay in memory in the browser tab and are never written to storage or logs. Only the cropped area is sent, and only when the user taps "Send to AI check". API keys live in the browser's localStorage, or sessionStorage if "forget when the tab closes" is chosen. They are sent only to the chosen provider.

See [docs/PLAN.md](docs/PLAN.md) for design decisions and what's left.
