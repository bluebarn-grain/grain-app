# Blue Barn Grain — Scale App

Scale house app for Blue Barn Land & Cattle. Weighs trucks in and out, reads the Rice Lake 720i and the moisture tester over serial, prints tickets on the OKI, and saves everything to the Blue Barn Grain Google Sheet. Keeps working with no internet and uploads when it's back.

## What's in here

| File | What it is |
| --- | --- |
| `index.html`, `app.js`, `styles.css` | The scale app |
| `parsers.js` | Reads the scale and moisture tester lines; splits loads by share |
| `sw.js`, `manifest.webmanifest` | Lets the app open with no internet |
| `backend/Code.gs` | Google Apps Script backend that writes to the Sheet |
| `test/` | Automated tests (run with Node; not needed on the scale PC) |

## Setup

### 1. Turn on hosting (once)
On github.com in this repository: **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: main, folder: / (root) → Save.**
After a minute the app is at **https://bluebarn-grain.github.io/grain-app/**.
(A private repository needs GitHub Pro for this.)

### 2. Set up the backend (once, from a computer, about 10 minutes)
Signed in to Google as **bluebarn.grain@gmail.com**:
1. Go to **script.google.com → New project**. Name it **Blue Barn Grain Backend**.
2. Delete what's in the editor, paste in everything from `backend/Code.gs`, and click **Save**.
3. In the function menu at the top, pick **setupTest**, click **Run**, and approve the Google permission prompts.
4. Open **Execution log**. Copy the **Backend key** it prints.
5. **Deploy → New deployment → Select type: Web app.** Execute as: **Me**. Who has access: **Anyone**. Click **Deploy** and copy the **Web app URL**.
   (Anyone can reach the address, but nothing happens without the key.)

### 3. Connect the app
Open the app, then **Settings**: paste the Web app URL and the key, click **Test connection**, check the starting ticket and bill of lading numbers, and **Save**.

### 4. Test
Turn on **Simulator** in Settings to test anywhere, including an iPad. On the scale PC, turn the simulator off and use **Connect serial port** once for each adapter. The app works out which port is the scale and which is the moisture tester from what they send.

## Scale PC tips
- Use **Chrome** or **Edge**. Serial ports don't work in Safari or Firefox.
- Install it as an app: Chrome menu → **Cast, save and share → Install page as app**.
- To print without the print dialog every time, start Chrome with `--kiosk-printing` and set the OKI as the default printer.
- Don't clear this browser's data while the app shows tickets waiting to sync.

## Going live
In the backend, paste the real Sheet ID into `switchToLive()` and run it once. In the app's Settings, turn off **Test mode** and enter the real starting ticket and bill of lading numbers.

## Tests
```
node test/unit.test.js          # parsers and backend logic
node test/server.js &           # fake backend on a mock Sheet
node test/e2e.js shot.png       # browser run-through on the simulator
```
