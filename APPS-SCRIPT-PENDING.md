# Apps Script — one change waiting: clinical records in their own spreadsheet

**The previous batch is done.** The three changes this file used to list —
the UHID fix, the Clinical Sheets split, and Implant Brands — are confirmed
live: `getNextUHID` returns the new format (`AL0901`) and
`getImplantBrandsList` answers. This replaces them.

---

## What this does

Today every clinical form's records — RCT, Crown & Bridge, both implant
forms, Local Anesthesia, Denture, Pedo, Restoration and the rest — sit in the
main PMS spreadsheet, alongside Registrations, Appointments and the Daily
Register. This moves them into a spreadsheet of their own.

- **All form records go to one new file**, one tab per form — the same tabs
  you have today.
- **Existing records are copied across.** Nothing in the PMS spreadsheet is
  deleted or edited; the originals stay exactly where they are.
- **The app only switches to the new file after every copy has been checked**
  against its original — same number of rows, same number of columns. If any
  copy does not match, it does not switch and nothing changes.
- **Registrations, Appointments, the Daily Register and Finance stay where
  they are.** Only clinical form data moves.

It is done in two parts. Part 1 can be done any time — on its own it changes
nothing. Part 2 is the actual move and should be done outside clinic hours.

---

## Part 1 — paste and deploy (safe any time)

On its own this changes nothing: until Part 2 is done, every record keeps
saving to the PMS spreadsheet exactly as now.

### Block A

**Ctrl+F for `CLINICAL RECORDS — Secondary Sheet`.** Select from that line
down to the closing `}` of `function getClinicalSheet` — the last line before
`// Generic fetch by UHID from any clinical tab`. Paste this in its place:

```javascript
// CLINICAL RECORDS — their own spreadsheet
// ════════════════════════════════════════════════════════════
// Every clinical form's records live in a spreadsheet of their own, kept apart
// from Registrations, Appointments and Finance. Which spreadsheet is set by the
// Script Property CLINICAL_SHEET_ID — never by editing code — the same way
// Finance's is.
//
// Until that property is set, everything stays in this (the PMS) spreadsheet
// exactly as before, so this can be deployed before the new file exists.
// Setting it is done by copyClinicalRecordsToNewFile below, not by hand, so the
// app is never pointed at a file its records have not been copied into yet.
var CLINICAL_SHEET_ID_DEFAULT = "1DtoZ3MNFq2Enr-ClAjENWFzk8SF2dYN9e1nGf7tAJC4";

function getClinicalSheetId() {
  var stored = PropertiesService.getScriptProperties().getProperty("CLINICAL_SHEET_ID");
  return stored || CLINICAL_SHEET_ID_DEFAULT;
}

// Kept for setupClinicalRecordTabs, which opens the clinical file by this name.
var CLINICAL_SHEET_ID = getClinicalSheetId();

function getClinicalSheet(tabName) {
  var ss = SpreadsheetApp.openById(getClinicalSheetId());
  var sh = ss.getSheetByName(tabName);
  if (!sh) {
    sh = ss.insertSheet(tabName);
  }
  return sh;
}

// ── One-off: move the clinic's form records into their own spreadsheet ───
// Copies every clinical tab from this spreadsheet into the new one, checks
// that each copy holds exactly as many rows and columns as its original, and
// only then points the app at the new file. Nothing in this spreadsheet is
// deleted or edited — the originals stay exactly as they are.
//
// Before running it:
//   1. Make a new, empty Google Sheet. Copy the long ID out of its address
//      bar — the part between /d/ and /edit.
//   2. Project Settings → Script Properties → Add script property
//        CLINICAL_SHEET_ID_NEW   =   that ID
//   3. Pick copyClinicalRecordsToNewFile in the function list, Run, and read
//      the Execution log.
// Run it outside clinic hours: a record saved while it runs lands in this
// file after its tab has already been copied, and would not be in the new one.
//
// Safe to re-run until it has switched over — a tab left by an earlier,
// interrupted run is replaced rather than duplicated. Once it has switched it
// refuses to run, so the live file can never be overwritten from here.
var CLINICAL_FLAT_TABS = [
  "Pathology", "Radiology", "Radiograph", "Local Anesthesia", "Intra Oral Scan",
  "Scaling", "Minor Surgery", "TMJoint", "Restoration", "Orthodontics",
  "Orthodontics Progress", "Denture", "Pedo", "Lab Log", "Prescriptions",
  // Historical flat tabs for the four JSON-blob forms.
  "RCT", "Implant Surgery", "Implant Prosthetic", "Crown & Bridge"
];

function clinicalTabsToCopy_() {
  var names = CLINICAL_FLAT_TABS.slice();
  names.push(CLINICAL_SHEETS_SHARED_TAB);
  for (var k in CLINICAL_SHEET_TABS) names.push(CLINICAL_SHEET_TABS[k]);
  return names;
}

function copyClinicalRecordsToNewFile() {
  var props = PropertiesService.getScriptProperties();
  var newId = String(props.getProperty("CLINICAL_SHEET_ID_NEW") || "").trim();
  if (!newId) {
    Logger.log("Set the Script Property CLINICAL_SHEET_ID_NEW to the new spreadsheet's ID first. Nothing was done.");
    return;
  }
  if (newId === CLINICAL_SHEET_ID_DEFAULT) {
    Logger.log("CLINICAL_SHEET_ID_NEW is this spreadsheet's own ID — it has to be a different, new file. Nothing was done.");
    return;
  }
  if (props.getProperty("CLINICAL_SHEET_ID") === newId) {
    Logger.log("The app already uses that spreadsheet. Refusing to copy over live records. Nothing was done.");
    return;
  }

  var from = SpreadsheetApp.openById(CLINICAL_SHEET_ID_DEFAULT);
  var to = SpreadsheetApp.openById(newId);
  var copied = [], absent = [], problems = [];

  clinicalTabsToCopy_().forEach(function(name) {
    var src = from.getSheetByName(name);
    if (!src) { absent.push(name); return; }
    var copy = src.copyTo(to);
    // A tab by this name in the new file can only be left over from an
    // earlier, interrupted run — the new file is not live yet — so replace it.
    var old = to.getSheetByName(name);
    if (old) to.deleteSheet(old);
    copy.setName(name);
    var rs = src.getLastRow(), cs = src.getLastColumn();
    var rc = copy.getLastRow(), cc = copy.getLastColumn();
    if (rs !== rc || cs !== cc) {
      problems.push(name + ": original " + rs + " rows x " + cs + " cols, copy " + rc + " x " + cc);
    } else {
      copied.push(name + " (" + Math.max(rs - 1, 0) + " records)");
    }
  });

  // A new spreadsheet starts with an empty "Sheet1"; drop it so the file holds
  // only the clinic's own tabs.
  var blank = to.getSheetByName("Sheet1");
  if (blank && blank.getLastRow() === 0 && to.getSheets().length > 1) to.deleteSheet(blank);

  Logger.log("Copied " + copied.length + " tab(s):\n  " + copied.join("\n  "));
  if (absent.length) Logger.log("Not in this spreadsheet, so nothing to copy: " + absent.join(", "));

  if (problems.length) {
    Logger.log("NOT SWITCHED — these copies do not match their originals:\n  " + problems.join("\n  "));
    Logger.log("The app still uses this spreadsheet and nothing here was changed. Run this again.");
    return;
  }
  props.setProperty("CLINICAL_SHEET_ID", newId);
  Logger.log("Every copy matches its original. The app now reads and saves form records in the new spreadsheet.");
  Logger.log("Nothing in this spreadsheet was deleted or changed.");
}
```

### Block B

**Ctrl+F for `Each of the four forms gets its own tab`.** Select from that
line down to the closing `}` of `function migrateClinicalSheetsToOwnTabs` — the
last line before the `DAILY REGISTER` banner. Paste this in its place:

```javascript
// All four open the clinical spreadsheet through getClinicalSheet, like every
// other form — not the PMS file through getSheet. The stale-row clean-up in
// saveClinicalSheets therefore only ever deletes within that one file.
// Each of the four forms gets its own tab instead of all of them sharing one.
// NOTE the "Clinical Sheets - " prefix: flat tabs named "RCT", "Implant
// Surgery", "Implant Prosthetic" and "Crown & Bridge" already exist in this
// same spreadsheet for pasting in historical records, and reusing those names
// would have written JSON blobs straight over them.
var CLINICAL_SHEETS_SHARED_TAB = "Clinical Sheets";
var CLINICAL_SHEET_HEADERS = ["UHID", "Patient Name", "Sheet Type", "All Teeth Data", "Saved At"];
var CLINICAL_SHEET_TABS = {
  "RCT":                "Clinical Sheets - RCT",
  "Implant Surgery":    "Clinical Sheets - Implant Surgery",
  "Implant Prosthetic": "Clinical Sheets - Implant Prosthetic",
  "Crown Bridge":       "Clinical Sheets - Crown Bridge"
};

function clinicalSheetTabName_(sheetType) {
  return CLINICAL_SHEET_TABS[String(sheetType || "").trim()] || CLINICAL_SHEETS_SHARED_TAB;
}

// Locates a patient's row WITHOUT touching the "All Teeth Data" column.
// That column holds the entire record for every tooth as JSON, so reading the
// whole range just to find one row pulled and parsed every record in the tab
// on every open and every save. Only the three key columns are read here; the
// blob is fetched afterwards, for the single row that matched.
function findClinicalRow_(sh, uhid, sheetType) {
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var keys = sh.getRange(2, 1, last - 1, 3).getValues();
  for (var i = keys.length - 1; i >= 0; i--) {
    if (String(keys[i][0]).trim().toUpperCase() !== uhid) continue;
    if (sheetType && String(keys[i][2]).trim() !== sheetType) continue;
    return i + 2;
  }
  return -1;
}

function readClinicalRow_(sh, row) {
  var vals = sh.getRange(row, 1, 1, 5).getValues()[0];
  return {
    success: true,
    allTeeth: safeParseJSON(vals[3]),
    sheetType: vals[2],
    savedAt: vals[4]
  };
}

function getClinicalSheets(p) {
  var uhid = String(p.uhid || "").trim().toUpperCase();
  var sheetType = p.sheetType ? String(p.sheetType).trim() : null;

  // Its own tab first, then the shared one — so a record written before the
  // split is still found whether or not the migration has been run.
  var names = [];
  if (sheetType) {
    names.push(clinicalSheetTabName_(sheetType));
  } else {
    for (var k in CLINICAL_SHEET_TABS) names.push(CLINICAL_SHEET_TABS[k]);
  }
  names.push(CLINICAL_SHEETS_SHARED_TAB);

  var best = null;
  for (var n = 0; n < names.length; n++) {
    var sh = getClinicalSheet(names[n]);
    var row = findClinicalRow_(sh, uhid, sheetType);
    if (row < 0) continue;
    var hit = readClinicalRow_(sh, row);
    // With a sheetType the first hit is the answer. Without one the caller
    // wants this patient's most recent record, whichever form it came from.
    if (sheetType) return hit;
    if (!best || String(hit.savedAt || "") > String(best.savedAt || "")) best = hit;
  }
  return best || { success: true, allTeeth: null };
}

function saveClinicalSheets(p) {
  var uhid = String(p.uhid || "").trim().toUpperCase();
  var sheetType = String(p.sheetType || "").trim();
  var sh = getClinicalSheet(clinicalSheetTabName_(sheetType));
  if (sh.getLastRow() === 0) sh.appendRow(CLINICAL_SHEET_HEADERS);

  var rowValues = [p.uhid, p.patientName, sheetType, safeJSON(p.allTeeth), new Date().toISOString()];
  var row = findClinicalRow_(sh, uhid, sheetType);
  if (row > 0) sh.getRange(row, 1, 1, 5).setValues([rowValues]);
  else sh.appendRow(rowValues);

  // The same record may still sit in the shared tab from before the split.
  // Drop it only now that the newer copy is safely written, so the row is
  // moved rather than deleted — two copies would otherwise drift apart.
  if (sh.getName() !== CLINICAL_SHEETS_SHARED_TAB) {
    var shared = getClinicalSheet(CLINICAL_SHEETS_SHARED_TAB);
    var stale = findClinicalRow_(shared, uhid, sheetType);
    if (stale > 0) shared.deleteRow(stale);
  }
  return { success: true };
}

// ── One-off, safe to re-run ──────────────────────────────────────────────
// Copies existing records out of the shared tab into each form's own tab.
// Nothing is deleted: rows stay in the shared tab until the next save of that
// record moves them. Run it from the Apps Script editor and read the log.
function migrateClinicalSheetsToOwnTabs() {
  var shared = getClinicalSheet(CLINICAL_SHEETS_SHARED_TAB);
  var last = shared.getLastRow();
  if (last < 2) { Logger.log("Shared tab is empty — nothing to migrate."); return; }

  var moved = 0, skipped = 0, unknown = 0;
  var keys = shared.getRange(2, 1, last - 1, 3).getValues();
  for (var i = 0; i < keys.length; i++) {
    var uhid = String(keys[i][0]).trim().toUpperCase();
    var sheetType = String(keys[i][2]).trim();
    if (!uhid) continue;
    var tab = CLINICAL_SHEET_TABS[sheetType];
    if (!tab) { unknown++; continue; }

    var target = getClinicalSheet(tab);
    if (target.getLastRow() === 0) target.appendRow(CLINICAL_SHEET_HEADERS);

    var existing = findClinicalRow_(target, uhid, sheetType);
    var src = shared.getRange(i + 2, 1, 1, 5).getValues()[0];
    if (existing > 0) {
      // Never overwrite a newer record with an older one.
      var there = target.getRange(existing, 5, 1, 1).getValues()[0][0];
      if (String(there || "") >= String(src[4] || "")) { skipped++; continue; }
      target.getRange(existing, 1, 1, 5).setValues([src]);
    } else {
      target.appendRow(src);
    }
    moved++;
  }
  Logger.log("Copied %s record(s) into their own tabs. %s already current, %s of an unrecognised type left alone.", moved, skipped, unknown);
  Logger.log("Nothing was deleted — the shared tab still holds every row.");
}
```

### Deploy, once

1. **Ctrl+S.**
2. **Deploy → Manage deployments → pencil → Version: New version → Deploy.**

Saving alone does nothing; the new version has to be deployed. After this the
app should behave exactly as it did before — that is the point of Part 1.

---

## Part 2 — make the new file and move the records

**Do this outside clinic hours.** Anything saved while the copy is running
lands in the PMS spreadsheet after its tab has already been copied, and would
not be in the new file.

1. **Make a new, empty Google Sheet** from the same Google account that owns
   this Apps Script project. Name it something like *KB Dental — Clinical
   Records*.
2. **Copy its ID** from the address bar — the long part between `/d/` and
   `/edit`.
3. In the Apps Script editor: **Project Settings (the gear) → Script
   Properties → Add script property**
   - Property: `CLINICAL_SHEET_ID_NEW`
   - Value: the ID you copied

   **Save script properties.**
4. Back in the editor, pick **`copyClinicalRecordsToNewFile`** in the function
   list at the top, and press **Run**. If Google asks for permission, allow it.
5. **Read the Execution log.** It should end with:

   > Every copy matches its original. The app now reads and saves form
   > records in the new spreadsheet.
   > Nothing in this spreadsheet was deleted or changed.

   If it says **NOT SWITCHED** instead, the app is still using the PMS
   spreadsheet and nothing has changed. The log names the tab that did not
   copy cleanly — just run it again. It is safe to re-run: a half-copied tab
   is replaced, not duplicated.

**No redeploy is needed for Part 2.** The app reads which spreadsheet to use
on every request, so the switch takes effect the moment the copy finishes.

Once it has switched, running `copyClinicalRecordsToNewFile` again does
nothing — it refuses, so the live records can never be overwritten from the
editor.

---

## How to tell it worked

- Open the new spreadsheet: it should have a tab for each form, holding the
  same rows as the PMS spreadsheet's tabs of the same name.
- In the app, open a patient who already has records — **AD0502** (Crown &
  Bridge) or **AL0810** (RCT) — and check the Clinical Record still shows.
- The next real save from any form should appear in the **new** file, and the
  PMS spreadsheet's copy of that tab should not grow.

## If something is wrong

Delete the `CLINICAL_SHEET_ID` script property (not `_NEW`). The app goes
straight back to the PMS spreadsheet, where every original still is.

One thing to know before doing that: anything saved **after** the switch is
only in the new file, so it would not show until the property is set back.

---

## What is not changed

- Nothing in the PMS spreadsheet is deleted or edited, by either part.
- Registrations, Appointments, the Daily Register and Finance are untouched.
- The app itself (`index.html`) needs no change — it never knew which
  spreadsheet the records were in.
