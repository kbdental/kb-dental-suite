# Apps Script — the three changes still waiting

All three are `Code.gs`, which cannot be deployed from here. Do the three
pastes below, then **one** redeploy at the end — not one each.

Nothing here is urgent enough to interrupt a clinic day. Everything keeps
working as it does today until this is applied; #1 is the one that stops a
new problem appearing.

This supersedes `UHID-FORMAT-PATCH.md`, `IMPLANT-BRANDS-MASTER-PATCH.md` and
`CLINICAL-SHEETS-SPLIT-PATCH.md`, which are now removed.

---

## 1. Stop patients being stranded without a registration (do this one first)

This is why AL0808 (Dr Garima Chahal) had appointments and a clinical sheet but
did not exist in Patient Search.

`getNextUHID` builds `KBDC-2026-0043`, which is not the clinic's format, and
numbers from the sheet's **row count** — so deleting any row hands the next
patient a UHID that already belongs to someone. It also had a fallback that
invented `"AL" + four timestamp digits`, which looks like a real UHID but lands
in an impossible month.

**Ctrl+F for `function getNextUHID()`. Select from that line down to its
closing `}` and paste this in its place:**

```javascript
// UHID format: two-letter year code + 2-digit month + that month's running
// number. The year code started at AA for 2015 and advances one letter a year,
// so 2026 is AL — AL0777 is the 77th new patient of July 2026. The number
// restarts at 01 on the 1st of every month.
function uhidYearCode_(year) {
  var i = year - 2015;
  if (i < 0) i = 0;
  return String.fromCharCode(65 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26));
}

function getNextUHID() {
  var tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  var now = new Date();
  var prefix = uhidYearCode_(Number(Utilities.formatDate(now, tz, "yyyy")))
             + Utilities.formatDate(now, tz, "MM");

  // Read the highest number already issued this month instead of counting
  // rows: a row deleted for any reason would otherwise send the counter
  // backwards and reissue a UHID that already belongs to a patient.
  var sh = getSheet("Registrations");
  var data = sh.getDataRange().getValues();
  var highest = 0;
  if (data.length > 1) {
    var uhidCol = findRegColumn_(data[0], ["UHID", "Registration ID"]);
    if (uhidCol >= 0) {
      for (var i = 1; i < data.length; i++) {
        var v = String(data[i][uhidCol] || "").trim().toUpperCase();
        if (v.indexOf(prefix) !== 0) continue;
        var n = parseInt(v.substring(prefix.length), 10);
        if (!isNaN(n) && n > highest) highest = n;
      }
    }
  }

  // Two digits normally (AL0801 … AL0899); a month busy enough to pass 99
  // simply grows to three (AL08100) rather than wrapping or colliding.
  return { success: true, uhid: prefix + String(highest + 1).padStart(2, "0") };
}
```

To check it before trusting it: pick `getNextUHID` from the function dropdown,
Run, and open the Execution log. It prints the UHID it would issue next without
writing anything. If your newest patient this month is `AL0812`, it should say
`AL0813`.

---

## 2. Clinical Sheets — the slowness on RCT / Implant / Crown &amp; Bridge

`getClinicalSheets` read every column of every row — including `All Teeth Data`,
the column holding a patient's whole record for every tooth as JSON. Finding one
patient fetched and parsed every record in the tab. `saveClinicalSheets` did the
same to locate the row it was about to update. All four forms also shared one
tab, so it grew every time any of them was used.

Row lookup now reads only the three key columns and fetches the blob afterwards,
for the row that matched. On a 200-row tab that is 605 cells instead of 1000.

**Ctrl+F for `function getClinicalSheets(p) {`. Select from that line down to —
but NOT including — the `// DAILY REGISTER` banner comment below it. That block
is `getClinicalSheets` and `saveClinicalSheets`. Paste this in its place:**

```javascript
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
    var sh = getSheet(names[n]);
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
  var sh = getSheet(clinicalSheetTabName_(sheetType));
  if (sh.getLastRow() === 0) sh.appendRow(CLINICAL_SHEET_HEADERS);

  var rowValues = [p.uhid, p.patientName, sheetType, safeJSON(p.allTeeth), new Date().toISOString()];
  var row = findClinicalRow_(sh, uhid, sheetType);
  if (row > 0) sh.getRange(row, 1, 1, 5).setValues([rowValues]);
  else sh.appendRow(rowValues);

  // The same record may still sit in the shared tab from before the split.
  // Drop it only now that the newer copy is safely written, so the row is
  // moved rather than deleted — two copies would otherwise drift apart.
  if (sh.getName() !== CLINICAL_SHEETS_SHARED_TAB) {
    var shared = getSheet(CLINICAL_SHEETS_SHARED_TAB);
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
  var shared = getSheet(CLINICAL_SHEETS_SHARED_TAB);
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

    var target = getSheet(tab);
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

Note the `Clinical Sheets - ` prefix on the new tab names. Flat tabs named
`RCT`, `Implant Surgery`, `Implant Prosthetic` and `Crown & Bridge` already
exist in the same spreadsheet for pasting in historical records, and the bare
names would have written JSON blobs over them.

**After deploying**, optionally run `migrateClinicalSheetsToOwnTabs` from the
function dropdown. It copies existing records into the new tabs and prints what
it moved. Nothing is deleted, it is safe to re-run, and a newer record is never
overwritten by an older one. You do not have to run it for things to work —
reads still check the shared tab — it is what makes the shared tab shrink.

---

## 3. Implant brands and sizes, maintained by you

Puts the implant brand list and each brand's sizes in
**Master → Clinic → Implant Brands &amp; Sizes**, so a new system or a
discontinued size is something you change yourself.

**3a. Ctrl+F for this line:**

```javascript
      case "getMedicineDosagesList":       return getMedicineDosagesList();
```

**and paste these two lines directly ABOVE it:**

```javascript
      case "getImplantBrandsList":         return getImplantBrandsList();
      case "saveImplantBrandsList":       return saveImplantBrandsList(p);
```

**3b. Ctrl+F for `function getMedicineDosagesList() {` and paste this directly
ABOVE that line:**

```javascript
// Implant brands and the sizes each is stocked in — maintained by the clinic
// in Master (Clinic > Implant Brands & Sizes) rather than fixed in the app,
// so a new system or a discontinued size is a sheet edit, not a code change.
// Sizes are one comma-separated string per brand; the form splits them and
// still accepts anything typed, so an unlisted size never blocks a case.
function getImplantBrandsList() {
  var sh = getSheet("Implant Brands");
  var data = sh.getDataRange().getValues();
  var items = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    items.push({ name: String(data[i][0]).trim(), sizes: String(data[i][1] || "").trim() });
  }
  return { success: true, brands: items };
}
function saveImplantBrandsList(p) {
  var sh = getSheet("Implant Brands");
  sh.clearContents();
  sh.appendRow(["Brand", "Sizes", "Updated At"]);
  var arr = [];
  try { arr = JSON.parse(p.brands); } catch (e) { if (Array.isArray(p.brands)) arr = p.brands; }
  var now = new Date().toISOString();
  arr.forEach(function(b) { sh.appendRow([b.name, b.sizes || "", now]); });
  return { success: true };
}
```

---

## Now deploy, once

**Save (Ctrl+S) → Deploy → Manage deployments → edit (pencil) → Version: New
version → Deploy.**

Without the redeploy the web app keeps serving the old code and nothing above
takes effect — that is what cost us several rounds on the tooth-range fix.

## Then

- Open **Master → Clinic → Implant Brands &amp; Sizes** and add the systems you
  actually stock. Sizes are comma separated. A size that is not on the list can
  still be typed straight into the form, so the list never blocks a case.
- Run `findOrphanRegistrations` (from `restore-missing-registration.gs`) if you
  have not — it is read-only and lists any other patient in AL0808's position.
