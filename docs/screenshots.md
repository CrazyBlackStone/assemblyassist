# Assembly Assist: screenshots

Screenshots are kept for every version ("era") of the app, newest first. Each era has its own folder under [`screenshots/`](screenshots/) and is never overwritten: a new look gets a new folder and a new row here.

| Era | Date | Look | Screenshots |
| --- | --- | --- | --- |
| **5. Minimal glass** (current) | 24 Nov 2026 | Glass panels in greys over a neutral field, one ink colour for actions; colour only for meaning (green good, red problem, amber pin-1 and warnings). Light by default. | [below](#era-5-minimal-glass-current) |
| 4. Liquid Glass in colour | 24 Nov 2026 | Light glass over a pastel colour field, blue accent, coloured icons. Replaced the same day. | [4-liquid-glass-colour](screenshots/4-liquid-glass-colour/README.md) |
| 3. 3D board, dark glass | 24 Nov 2026 | Dark glass; 3D board with real part sizes, zoom, front and back. | [3-3d-board](screenshots/3-3d-board/README.md) |
| 2. Workspace redesign | 24 Nov 2026 | Projects workspace, three build panels, voice bar, Done review; 2D board. | [2-workspace-redesign](screenshots/2-workspace-redesign/README.md) |
| 1. First version | 23 Nov 2026 | Single build page with blocks, tray mode, checkpoints and an AI keys screen. | [1-first-version](screenshots/1-first-version/README.md) |

<table><tr>
<td><a href="screenshots/4-liquid-glass-colour/README.md"><img src="screenshots/4-liquid-glass-colour/03-build.webp" alt="Era 4" width="230"></a><br>Era 4</td>
<td><a href="screenshots/3-3d-board/README.md"><img src="screenshots/3-3d-board/06-build.webp" alt="Era 3" width="230"></a><br>Era 3</td>
<td><a href="screenshots/2-workspace-redesign/README.md"><img src="screenshots/2-workspace-redesign/06-build.webp" alt="Era 2" width="230"></a><br>Era 2</td>
<td><a href="screenshots/1-first-version/README.md"><img src="screenshots/1-first-version/02-build-polarized-part.png" alt="Era 1" width="230"></a><br>Era 1</td>
</tr></table>

## Era 5: Minimal glass (current)

The live app at https://crazyblackstone.github.io/assemblyassist/, captured in Chromium at 1600×950 (phone shots at iPhone 13 size).

How these were made:
- **Board:** the bundled demo project (ATtiny85 blinker, 20 parts, Gerbers included). The 3D view renders in software here; a laptop's GPU is smoother.
- **Camera:** a second browser acts as the phone and is paired with the laptop through the real pairing server. Its "camera" is a picture of the demo board, rendered from the demo Gerbers and tilted 4°.
- **AI:** no key is configured, so AI results are simulated and labeled **SIM**. With a key they show **AI**, and real verdicts and costs.
- **Voice:** a scripted recognizer stands in for the microphone.

### Workspace

![Projects](screenshots/5-minimal-glass/01-workspace.webp)

Each project is a glass card with its board render and a progress bar. **New Project** opens an empty setup. The **Light / Dark / Auto** switch sets the appearance (light by default).

### Setup

![Setup](screenshots/5-minimal-glass/02-setup.webp)

- **Board:** the project name, then one row each for **Gerbers** (.zip or files), **Placement** (CPL) and **Bill of Materials**. Tap a row to pick a file, or drop files on it.
- **Preview:** the board in 3D, rendered from the Gerbers, with part count, board size and layer count underneath. **Show Back** flips it.
- **Assembly:** turn **Check Soldering** off for solder-paste boards. **Camera** and **Microphone** each come from the phone or this device. **Board Orientation** turns the board view to match the bench.
- **Phone:** scan the QR code with the phone to pair it.
- **Build Order:** drag parts, or whole categories by their name. **Suggest Order** asks the model for an order, which you accept or keep.

### Build

#### Before the phone connects

![Build screen waiting for the phone](screenshots/5-minimal-glass/03-build-waiting-for-phone.webp)

The camera panel shows the pairing QR code until a phone connects.

#### On the phone

![Phone connect](screenshots/5-minimal-glass/04-phone-connect.webp) ![Phone streaming](screenshots/5-minimal-glass/05-phone-streaming.webp)

#### Building

![Build screen](screenshots/5-minimal-glass/06-build.webp)

- **Rail:** the build order as ref des.
- **Panel 1:** the current part, its package drawn as it sits on the board with the pin-1 dot lit, an arrow pointing to the mark, **Up Next**, and Back / Skip / Next.
- **Panel 2:** the board in 3D, textured from the Gerbers, with the current part hovering over its spot.
- **Panel 3:** the phone's camera.
- **Bottom bar:** a placement tip for the package type.

#### Zooming into the board

![Zoomed board](screenshots/5-minimal-glass/06b-board-zoom.webp)

Scroll or pinch to zoom, drag to pan, double-tap a part to zoom on it, or say "zoom in" / "zoom on U1". The + / − / fit buttons do the same, and the last button flips to the back.

#### Camera calibration

![Calibration](screenshots/5-minimal-glass/07-calibrate.webp)

Tap the two highlighted parts on the video; the board view rings the same part. From then on, every check crops its part automatically.

#### Check after each placement

![No problem](screenshots/5-minimal-glass/08-check-no-problem.webp)

After **Next**, the video blurs and the cropped part appears on a glass card with orientation and solder verdicts. The best result is "AI sees no problem", and the user still confirms with **Looks Good** or **✕**.

![Flipped](screenshots/5-minimal-glass/09-check-flipped.webp)

The crop is turned to the part's reference orientation, so the model is told exactly where the mark must be. A flipped part shows in red on the board until it is fixed.

![Can't tell](screenshots/5-minimal-glass/10-check-cant-tell.webp)

#### Voice

![Voice command](screenshots/5-minimal-glass/11-voice-command.webp)

Short commands such as "do the LEDs next" are handled locally and reorder the build at once.

![Voice assistant](screenshots/5-minimal-glass/12-voice-assistant.webp)

Anything else goes to the language model. Answers cite the technique-library entry they came from, and the thumbs-down logs a wrong answer.

#### Reordering

![Order drawer](screenshots/5-minimal-glass/13-order-drawer.webp)

Tapping the rail opens the full list, where parts and categories can be dragged mid-build. On two-sided boards the list has Front and Back sections and a button to build the other side first.

![Board tilted](screenshots/5-minimal-glass/13b-board-tilted.webp)

Placed parts are modelled at their real size: package length, width and seated height from the footprint name, a datasheet table, or the netlist's pads. Footprints from the KiCad library load KiCad's own 3D model.

#### Done: review every part

![Review running](screenshots/5-minimal-glass/14-review-running.webp)

**Done** takes one photo, crops every placed part and checks them in order. Each part lights up on the board as its check runs.

![Review finished](screenshots/5-minimal-glass/15-review-done.webp)

Tap a tile to see its verdicts.

### Cost and failure log

![Log](screenshots/5-minimal-glass/16-log.webp)

The cost chip at the top right opens the cost of each call type (speech, image, language), any model replacements, and the failure log with JSON/CSV export.

### Phone-only mode

![Phone-only build](screenshots/5-minimal-glass/17-phone-only-build.webp)

With **Camera: This Device**, the whole app runs on one phone and the panels stack.

### Dark appearance

![Dark](screenshots/5-minimal-glass/18-dark.webp)

The same glass in Dark, chosen with the switch on the Projects page (Auto follows the system).
