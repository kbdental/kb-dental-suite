// ═══════════════════════════════════════════════════════════════════════════
// RETIRE THE SECOND DOCTORS LIST
//
// There were two doctors lists in this book:
//     "Doctor Details"  — what Master edits: name, phone, email, role
//     "Doctors"         — names only, written by the settings screen
//
// Which one a screen showed depended on the screen, and on top of both the
// backend carried a hardcoded pair of names that won whenever a tab was
// empty. Doctor Details is the one list now.
//
// This moves any name that is ONLY in "Doctors" into "Doctor Details", then
// deletes the "Doctors" tab. Names already in Doctor Details keep their phone,
// email and role — the second list never held those, so taking anything from
// it would be a downgrade.
//
//   reportDoctorsTabs   READ-ONLY. Both lists side by side, what would move,
//                       and whether the tab would be deleted. Run this first.
//   retireDoctorsTab    Moves the names, then deletes the tab.
//
// Run it in BOTH books: K. B. DENTAL SUITE - PMS and KB Dental — PMS Empaneled.
// Do the Code.gs paste FIRST. getSheet() creates a tab that is missing, so
// while the old functions are still deployed, deleting "Doctors" only lasts
// until the next call and it comes quietly back.
// ═══════════════════════════════════════════════════════════════════════════

var CONFIRM_RETIRE = "";

var FINANCE_BOOK_ID_RD = "1Zdxq3Xf-e41Xak4VDcufrURLkKDAp8MvRCZadC0htUI";
var DETAILS_TAB = "Doctor Details";
var OLD_TAB = "Doctors";
var DETAILS_HEADER = ["Name", "Phone", "Email", "Role", "Updated At"];

function rdBook_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    Logger.log("This project is not attached to a spreadsheet. Paste this into the");
    Logger.log("Apps Script of the PMS book or the empanelled book.");
    return null;
  }
  if (ss.getId() === FINANCE_BOOK_ID_RD) {
    Logger.log('REFUSED: "%s" is the finance workbook. Doctors live in the', ss.getName());
    Logger.log("patient books, not the accounts one. Nothing was changed.");
    return null;
  }
  return ss;
}

function rdNames_(sh, col) {
  var out = [];
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, col, sh.getLastRow() - 1, 1).getValues().forEach(function (r) {
    var v = String(r[0] == null ? "" : r[0]).trim();
    if (v) out.push(v);
  });
  return out;
}

// READ-ONLY.
function reportDoctorsTabs() {
  var ss = rdBook_(); if (!ss) return;
  Logger.log('Book: "%s"', ss.getName());
  Logger.log("");

  var details = ss.getSheetByName(DETAILS_TAB);
  var old = ss.getSheetByName(OLD_TAB);

  var kept = rdNames_(details, 1);
  Logger.log('%s (the list that stays) — %s name(s):', DETAILS_TAB, kept.length);
  kept.forEach(function (n) { Logger.log("   %s", n); });
  if (!kept.length) Logger.log("   (none)");

  Logger.log("");
  if (!old) {
    Logger.log('There is no "%s" tab in this book. Nothing to retire.', OLD_TAB);
    return;
  }
  var oldNames = rdNames_(old, 1);
  Logger.log('%s (the list being retired) — %s name(s):', OLD_TAB, oldNames.length);
  oldNames.forEach(function (n) { Logger.log("   %s", n); });
  if (!oldNames.length) Logger.log("   (none)");

  var missing = oldNames.filter(function (n) { return kept.indexOf(n) < 0; });
  Logger.log("");
  if (missing.length) {
    Logger.log("WOULD BE MOVED into %s (with blank phone/email and role Doctor):", DETAILS_TAB);
    missing.forEach(function (n) { Logger.log("   %s", n); });
  } else {
    Logger.log("Every name in %s is already in %s, so nothing moves.", OLD_TAB, DETAILS_TAB);
  }
  Logger.log('The "%s" tab would then be deleted.', OLD_TAB);
  Logger.log("");
  Logger.log('To do it: set CONFIRM_RETIRE = "YES" at the top, then run retireDoctorsTab.');
  Logger.log("Nothing has been changed.");
}

function retireDoctorsTab() {
  var ss = rdBook_(); if (!ss) return;
  if (String(CONFIRM_RETIRE).trim().toUpperCase() !== "YES") {
    Logger.log("Nothing was changed — CONFIRM_RETIRE is not set.");
    Logger.log('Book: "%s"', ss.getName());
    Logger.log('Run reportDoctorsTabs first, then set CONFIRM_RETIRE = "YES".');
    return;
  }
  var old = ss.getSheetByName(OLD_TAB);
  if (!old) { Logger.log('No "%s" tab in this book. Nothing to do.', OLD_TAB); return; }

  var details = ss.getSheetByName(DETAILS_TAB);
  if (!details) { details = ss.insertSheet(DETAILS_TAB); details.appendRow(DETAILS_HEADER); }
  if (details.getLastRow() === 0) details.appendRow(DETAILS_HEADER);

  var kept = rdNames_(details, 1);
  var moved = 0;
  var now = new Date().toISOString();
  rdNames_(old, 1).forEach(function (n) {
    if (kept.indexOf(n) >= 0) return;          // already there, with its details
    details.appendRow([n, "", "", "Doctor", now]);
    kept.push(n);
    moved++;
    Logger.log("   moved %s", n);
  });

  ss.deleteSheet(old);
  Logger.log("");
  Logger.log('Done. %s name(s) moved; the "%s" tab is deleted.', moved, OLD_TAB);
  Logger.log('"%s" now holds every doctor, and it is the only list.', DETAILS_TAB);
  Logger.log("");
  Logger.log("If the tab reappears, the Code.gs paste has not been deployed in this");
  Logger.log("book: the old functions create it again the first time one is called.");
  Logger.log('Set CONFIRM_RETIRE back to "" so this cannot run again by accident.');
}
