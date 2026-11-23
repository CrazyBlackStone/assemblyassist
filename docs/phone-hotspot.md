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
4. **On the laptop**, open https://crazyblackstone.github.io/assemblyassist/ → **Setup** → section 2 → choose **Phone over the board**. A QR code and a 6-letter code appear.
5. **On the phone**, scan the QR code with the camera app. It opens in Safari (iPhone) or Chrome (Android). Or open the same site and type the code. Tap **Start camera and connect** and allow camera and microphone.
6. **Check the laptop header**: it should change from *Phone: waiting* to **Phone: streaming**, and the live view on the Build screen shows the camera.
7. Prop the phone 15–25 cm above the board, camera facing down. Keep the phone page open in the foreground; the app keeps the screen awake.

## If it doesn't connect

| What you see | Try |
| --- | --- |
| Phone says “No laptop found with that code” | Check the code matches the laptop. On the laptop, stay on the app (don't close the tab). Tap **New code** and scan again. |
| Phone or laptop says it can't reach the pairing server | The phone has no data. Check mobile data is on and the hotspot shows the laptop as connected. |
| “Found each other but could not connect directly” | Turn off VPNs on both devices (and iCloud Private Relay or similar “private” DNS features on the phone if needed). On iPhone, toggle **Maximize Compatibility**. On Windows, set the network to **Private**. Reload both pages. |
| Laptop shows *Phone: linked* but no video | Reload the phone page and tap **Start camera and connect** again. Make sure no other app is using the phone camera. |
| Voice commands from the phone don't work | Use Chrome on Android or Safari on iPhone; otherwise use the laptop's **Talk** button or the keyboard. |
| Still nothing | Use phone-only mode: open the site on the phone itself → Setup → **This device's camera**. Everything except the big laptop display works the same. |

If hotspots aren't an option on the network you'll present on, the long-term fix is a TURN relay (for example coturn on the EC2 server), entered under Setup → connection settings → ICE servers.
