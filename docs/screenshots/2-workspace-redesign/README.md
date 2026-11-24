# Era 2: Workspace redesign

*Screenshots from 24 Nov 2026, commit `bd5a656`. Kept as a record of this version; the app has changed since. [All eras](../../screenshots.md)*

The live app at https://crazyblackstone.github.io/assemblyassist/, captured in Chromium at 1600×950 (phone shots at iPhone 13 size).

How these were made:
- **Board:** the bundled demo project (ATtiny85 blinker, 20 parts, Gerbers included).
- **Camera:** a second browser acts as the phone and is paired with the laptop through the real pairing server. Its "camera" is a picture of the demo board, rendered from the demo Gerbers and tilted 4°.
- **AI:** no key is configured, so AI results are simulated and labeled **SIM**. With a key they show **AI**, and real verdicts and costs.
- **Voice:** a scripted recognizer stands in for the microphone.

## Workspace

![Projects](01-workspace.webp)

Each project card shows its board render and a progress ring. **New project** opens an empty setup.

## Setup

![Setup](02-setup.webp)

- **Files:** drop Gerber (.zip or files), BOM and CPL.
- **Preview and stats:** the board preview is rendered from the Gerbers, with part count, board size and layer count underneath.
- **Options:** turn **Check soldering** off for solder-paste boards. Camera and microphone each come from the phone or this device. **Board orientation** turns the board view to match the bench.
- **Phone:** scan the QR code with the phone to pair it.
- **Order:** drag parts, or whole categories by their header. **Suggest** asks the model for an order, which you accept or keep.

## Build

### Before the phone connects

![Build screen waiting for the phone](03-build-waiting-for-phone.webp)

The camera panel shows the pairing QR code until a phone connects.

### On the phone

![Phone connect](04-phone-connect.webp) ![Phone streaming](05-phone-streaming.webp)

### Building

![Build screen](06-build.webp)

- **Rail:** the build order as ref des.
- **Panel 1:** the current part, its package drawn as it sits on the board with the pin-1 dot lit, an arrow pointing to the mark, the next part, and Back / Skip / Next.
- **Panel 2:** the board from the Gerbers, with the current part hovering in place.
- **Panel 3:** the phone's camera.
- **Bottom bar:** a placement tip for the package type.

### Camera calibration

![Calibration](07-calibrate.webp)

Tap the two highlighted parts on the video; the board view rings the same part. From then on, every check crops its part automatically.

### Check after each placement

![No problem](08-check-no-problem.webp)

After **Next**, the video blurs and the cropped part appears with orientation and solder verdicts. The best result is "AI sees no problem", and the user still confirms with **Good** or **✕**.

![Flipped](09-check-flipped.webp)

The crop is turned to the part's reference orientation, so the model is told exactly where the mark must be. A flipped part shows in red on the board until it is fixed.

![Can't tell](10-check-cant-tell.webp)

### Voice

![Voice command](11-voice-command.webp)

Short commands such as "do the LEDs next" are handled locally and reorder the build at once.

![Voice assistant](12-voice-assistant.webp)

Anything else goes to the language model. Answers cite the technique-library entry they came from, and the thumbs-down logs a wrong answer.

### Reordering

![Order drawer](13-order-drawer.webp)

Tapping the rail opens the full list, where parts and categories can be dragged mid-build.

### Done: review every part

![Review running](14-review-running.webp)

**Done** takes one photo, crops every placed part and checks them in order. Each part lights up on the board as its check runs.

![Review finished](15-review-done.webp)

Tap a tile to see its verdicts.

## Cost and failure log

![Log](16-log.webp)

The cost chip in the top bar opens the cost of each call type (speech, image, language), any model replacements, and the failure log with JSON/CSV export.

## Phone-only mode

![Phone-only build](17-phone-only-build.webp)

With **Camera: This device**, the whole app runs on one phone and the panels stack.
