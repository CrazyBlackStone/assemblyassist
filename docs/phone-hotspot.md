# Connecting the phone over its own hotspot

Use this when the phone and laptop won't connect on campus or guest Wi-Fi. Those networks often block devices from talking to each other. On the phone's hotspot, the laptop and phone share one small private network, so the video goes straight from phone to laptop.

## What uses mobile data

| Traffic | Goes over | Size |
| --- | --- | --- |
| Loading the website (first time) | mobile data | about 0.5 MB |
| Pairing handshake (PeerJS server) | mobile data | a few KB |
| Live video, phone → laptop | **the hotspot only** (no mobile data, normally) | — |
| Each AI check (one cropped photo) | mobile data | about 50–150 KB |
| Build plan and fix help | mobile data | a few KB each |

The phone needs a working data connection, and the hotspot must be allowed on your plan.

## Steps

1. **Plug the phone into power.** Camera, screen and hotspot together drain the battery fast. Turn off Low Power Mode or Battery Saver; on some phones it switches the hotspot off.
2. **Turn on the hotspot on the phone.**
   - iPhone: Settings → Personal Hotspot → turn on **Allow Others to Join**. If the laptop can't see it, also turn on **Maximize Compatibility**.
   - Android: Settings → Network & internet (or Connections) → Hotspot & tethering → **Wi-Fi hotspot** → on. Note the network name and password.
3. **Connect the laptop to the phone's hotspot** in its Wi-Fi menu. Disconnect from campus Wi-Fi first, and turn off any VPN on the laptop.
   - Windows: if asked, choose **Private network** (Settings → Network → the hotspot → Network profile: Private). The firewall is stricter on "Public".
4. **On the laptop**, open https://crazyblackstone.github.io/assemblyassist/ and your project's **Setup** with **Camera: Phone**. A QR code and a 6-letter code appear there, and in the camera panel of the build screen until a phone connects.
5. **On the phone**, scan the QR code with the camera app. It opens in Safari (iPhone) or Chrome (Android). Tap **Connect** and allow the camera (and the microphone, if the project uses the phone's mic).
6. **Check the laptop**: the phone card in Setup changes to **Streaming**, and the camera panel on the build screen shows the video.
7. Prop the phone 15–25 cm above the board, camera facing down. Keep the phone page open in the foreground; the app keeps the screen awake.

## If it doesn't connect

| What you see | Try |
| --- | --- |
| Phone says “No laptop found with that code” | Check the code matches the laptop and keep the laptop tab open. Reload the laptop page and scan the QR code again. |
| The pairing server can't be reached | The phone has no data. Check mobile data is on and the hotspot shows the laptop as connected. |
| “Can’t connect directly on this Wi-Fi” | Turn off VPNs on both devices (and iCloud Private Relay or similar “private” DNS features on the phone if needed). On iPhone, toggle **Maximize Compatibility**. On Windows, set the network to **Private**. Reload both pages. |
| Setup shows *Linked* but no video | Reload the phone page and tap **Connect** again. Make sure no other app is using the phone camera. |
| Voice from the phone doesn't work | Set **Microphone: Laptop** in Setup, or use the keyboard. |
| Still nothing | Run the app on the phone alone: open the site there, open the demo or create the project on the phone (projects are stored per browser), and set **Camera: This device**. |

If hotspots aren't an option on the network you'll present on, the long-term fix is a TURN relay (for example coturn on the EC2 server), set as `VITE_ICE_SERVERS` at build time (see `.env.example`).
