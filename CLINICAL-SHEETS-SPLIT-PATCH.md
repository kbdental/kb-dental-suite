# Apps Script — split the Clinical Sheets tab, and stop reading every blob

Two changes to the same set of functions, both aimed at the slowness when
opening or saving RCT, Implant Surgery, Implant Prosthetic and Crown & Bridge.

**This is a `Code.gs` change, so only you can apply it.** Until it is pasted in,
everything keeps working exactly as it does today — just as slowly.

## What was wrong

**The read.** `getClinicalSheets` called `getDataRange().getValues()`, which
pulls *every column of every row* — including `All Teeth Data`, the column
holding each patient's entire record for every tooth as JSON. Finding one
patient meant fetching and parsing every record in the tab. `saveClinicalSheets`
did the same thing to locate the row it was about to update.

**The tab.** All four forms shared one `Clinical Sheets` tab, so each of those
full-table reads got slower every time any of the four was used.

## What changes

Row lookup now reads only the three key columns (`UHID`, `Patient Name`,
`Sheet Type`). The JSON blob is fetched afterwards, for the one row that
matched. Each form also gets its own tab, so a lookup scans roughly a quarter
as many rows to begin with.

Measured on a 200-row tab in the test: a read touched 605 cells instead of
1000, and none of them were blobs.

### Tab names

| Form | Tab |
| --- | --- |
| RCT | `Clinical Sheets - RCT` |
| Implant Surgery | `Clinical Sheets - Implant Surgery` |
| Implant Prosthetic | `Clinical Sheets - Implant Prosthetic` |
| Crown Bridge | `Clinical Sheets - Crown Bridge` |

The `Clinical Sheets - ` prefix matters. Flat tabs named `RCT`, `Implant
Surgery`, `Implant Prosthetic` and `Crown & Bridge` **already exist in this same
spreadsheet** for pasting in historical records. Using those names would have
written JSON blobs straight over them.

## How to apply it

1. Open the PMS spreadsheet → **Extensions → Apps Script**.
2. In `Code.gs`, Ctrl+F for `function getClinicalSheets(p) {`.
3. Select from that line down to — but **not including** — the
   `// DAILY REGISTER` banner comment a little further down. That block contains
   `getClinicalSheets` and `saveClinicalSheets`.
4. Delete it, and paste in the replacement block from
   `apps-script/out/Code.gs` in this repo — everything from
   `var CLINICAL_SHEETS_SHARED_TAB` down to the end of
   `migrateClinicalSheetsToOwnTabs`.
5. Save (Ctrl+S), then **Deploy → Manage deployments → edit → Version: New
   version → Deploy**.

Nothing needs to change in the app — it already calls these functions.

## Then run the migration, when it suits you

In the Apps Script editor, pick **`migrateClinicalSheetsToOwnTabs`** from the
function dropdown → **Run** → open the Execution log.

It copies existing records into their new tabs and prints how many it moved.

- **Nothing is deleted.** Every row stays in the shared tab. A row is only
  removed from there later, when that same record is next saved — and only
  after the newer copy has been written successfully.
- **Safe to re-run.** A record already in its own tab is skipped, and a newer
  record is never overwritten by an older shared copy.
- **You do not have to run it at all for things to work.** Reads check the
  shared tab as well, so a record written before the split is still found. The
  migration is what makes the shared tab shrink and the reads get faster.

## If something looks wrong afterwards

The old data is untouched in `Clinical Sheets`. Reverting is putting the
previous two functions back — the records are all still there.
