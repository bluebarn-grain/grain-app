# Blue Barn Grain — Scale App

Scale house app for Blue Barn Land & Cattle. Weighs trucks in and out, reads the Rice Lake 720i and the moisture tester over serial, prints tickets on the OKI, and saves everything to the Blue Barn Grain Google Sheet. Keeps working with no internet and uploads when it's back.

## What's in here

| File | What it is |
| --- | --- |
| `index.html`, `app.js`, `styles.css` | The scale app |
| `parsers.js` | Reads the scale and moisture tester lines; splits loads by share; picks the contract |
| `office.js`, `reports.js` | Office side: contracts, reports, inventory adjustments |
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

### 5. Nightly buyer emails (once)
Every night at 7 pm, each buyer that shipped grain gets one email from BBL&C: a block per contract (loads and bushels today, shipped to date, remaining, or "complete"), the ticket list, and a CSV of the tickets. Nights with no shipments send nothing. Test tickets are never sent.
1. **Customers tab → Email:** put each buyer's address. Several addresses can go in one cell, separated by commas. To send a contract to someone else, add an **Email** column on the **Contracts** tab and fill it on that row.
2. **Settings tab:** add a row **OfficeEmail** with your address. Replies go there, and so does a note if a ticket has no contract or a buyer has no email.
3. In the script editor, paste the new `backend/Code.gs`, save, pick **setupNightlyEmails**, click **Run**, and approve the new email permission. This makes the 7 pm trigger and a **Banter** tab.
4. To see tonight's emails without sending them to buyers, run **previewNightlyEmails**. Everything goes to OfficeEmail only.

**Banter tab:** the jokes rotate so a buyer doesn't see the same one twice in a row. Types are Opener, Payment, SignOff and Complete (used when a contract fills). Add lines, edit them, or set Active to FALSE to retire one.

**Tickets are never missed or sent twice.** Each email covers every outbound ticket not yet emailed, so a truck weighed after 7 pm, or a ticket put on a contract later, goes out the next night. The **EmailLog** tab lists what was sent.

**Contracts that fill.** Loads are never split. At weigh-out, if the contract has at least half this load left it takes the whole load (a little over is fine); if it has less, the whole load goes on the same buyer's next open contract for the same commodity (earliest shipment start first), even if that contract's shipment period hasn't started. The ticket prints the contract it went on and "(TEST-C1 FILLED)". A contract with less than half a typical load left drops off the scale's list; set **TypicalLoadBu** in Settings (default 1000). If the buyer has no other open contract, the load stays on the chosen contract and the office gets a warning. The **TicketContracts** tab shows which contract each ticket went on; fix a row there by hand if needed.

## Office side
Tap **Office** at the top (same app, same link). It works on the iPad or a phone, and shows the last copy when the internet is down.
- **Customers:** buyers, landlords and the farm (Operator). Name, pays-as, contact, phone, email, address. Inactive ones don't show at the scale.
- **Fields:** acres, Operations Center name, FSA farm/tract, insurance unit, and each crop year's owner split (must total 100%; "Same as last year" copies it). Fields with no split for the year are flagged. Loads already weighed keep the split they were saved with.
- **Contracts:** tap a contract for its **application report** — every ticket applied to it (ticket #, date/time, truck, BOL, gross, tare, net, bushels, running total, loads moved from a filled contract), with **Print report**. Add, change or close contracts from there. **Pricing:** open a contract and Add pricing — date, bushels, futures month, futures, basis, fees → flat (or a flat price on its own). A line can be basis-only or futures-only and filled in later. The list shows priced bushels and the average flat, and flags bushels shipped with no price (also on Inventory). Pricing can't exceed the contract bushels. Closed and filled contracts drop off the scale. The contract # can't change once saved.
- **Field report:** loads, wet and dry bushels, average moisture and test weight per field; tap a field for each owner's share and its tickets. Bushels per acre show once a field has acres.
- **Inventory:** on hand (opening + dry bushels in − out ± adjustments), what's left to ship on open contracts, and unsold, per crop and crop year.
- **Landlord grain:** each landlord's grain still in your bins (their share of each load, by the field's split, minus what you've bought). **Buy landlord grain** records buying some or all of it, with an optional price, so it becomes yours to sell; nothing moves. Inventory shows what's still theirs vs. yours, and unsold counts only yours. Bins empty is blocked until landlords' grain is bought. An opening balance can be put in a landlord's name.
- **Write-offs:** shrink written off at each bins-empty close-out, as bushels and % of what came in.
- **Adjustments:** opening balance, bins measured, bins empty (zero out), other. **Undo** marks the line Void in the Sheet; nothing is deleted.
- **Dry bushels** use water shrink to the commodity's standard moisture (Commodities tab). To use a flat shrink instead, add **ShrinkPerPoint** to Settings (e.g. 1.4 for 1.4% per point).
- **Print** prints the report you're looking at on letter paper.

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
node test/emails.test.js        # nightly buyer emails and contract roll-over
node test/reports.test.js       # office reports, contracts, adjustments
node test/server.js & node test/e2e-office.js   # office side in the browser
ROLLOVER=1 node test/server.js & node test/e2e-rollover.js   # roll-over in the browser
node test/server.js &           # fake backend on a mock Sheet
node test/e2e.js shot.png       # browser run-through on the simulator
```
