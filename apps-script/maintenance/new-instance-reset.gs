// ═══════════════════════════════════════════════════════════════════════════
// NEW INSTANCE — clear the patient data out of a copied book
//
// HOW TO MAKE A NEW INSTANCE
//   1. Open the PMS spreadsheet -> File -> Make a copy. This copies every tab
//      AND the bound Apps Script, so the new book already has the full
//      backend. Name it for what it is ("KB Dental - Empanelled", etc).
//   2. In the COPY: Extensions -> Apps Script -> Deploy -> New deployment ->
//      Web app -> Execute as: Me -> Who has access: Anyone -> Deploy.
//      Copy the /exec URL.
//   3. Paste that URL into KB_INSTANCES.<id>.scriptUrl in index.html.
//   4. For a blank instance, paste THIS file into the copy's Apps Script and
//      run the two functions below. Read the log each time.
//
//   reportInstanceData   READ-ONLY. Counts what is in each tab and shows what
//                        clearBookForNewInstance would remove and what it
//                        would keep. Always run this first.
//   clearBookForNewInstance
//                        Deletes the patient data rows. Keeps every tab, every
//                        header row, and all the master lists and settings, so
//                        the new book behaves like the original from day one.
//
// RUN THIS ONLY IN A COPY. It refuses to run in the live K.B. Dental book —
// see LIVE_SPREADSHEET_ID below — but that guard only knows about the one book
// it was told about. Check the spreadsheet name in the log before typing YES.
//
// This file is self-contained and shares no names with Code.gs, so it can sit
// alongside it without clashing.
// ═══════════════════════════════════════════════════════════════════════════

// The live clinic book. Never cleared, whatever else this script is told.
var LIVE_SPREADSHEET_ID = "1DtoZ3MNFq2Enr-ClAjENWFzk8SF2dYN9e1nGf7tAJC4";

// Typing this into CONFIRM is what actually allows the delete to happen.
var CONFIRM = "";

// Patient data — cleared for a blank instance. Header row is always kept.
var PATIENT_DATA_TABS = [
  "Registrations", "Appointments", "Daily Register", "Treatment Cases",
  "Clinical Sheets",
  "Clinical Sheets - RCT", "Clinical Sheets - Implant Surgery",
  "Clinical Sheets - Implant Prosthetic", "Clinical Sheets - Crown Bridge",
  "RCT", "Implant Surgery", "Implant Prosthetic", "Crown & Bridge",
  "Pathology", "Radiology", "Radiograph", "Local Anesthesia",
  "Intra Oral Scanning", "Scaling", "Minor Surgery", "TMJoint", "Restoration",
  "Orthodontics", "Orthodontics Progress", "Denture", "Pedo", "Lab Log",
  "Patient Documents", "Consents", "Care Plan", "Treatment Plan",
  "Patient Fee Receipt", "Receipts", "Expenses", "Signatures",
  // Prescriptions is patient data like any other form's tab. It was missed
  // when this list was first written, and the empanelled book's own report
  // is what caught it — a row would have been left behind.
  "Prescriptions",
  // A report about the ORIGINAL clinic's document migration. It says nothing
  // about the new instance and only confuses whoever reads it there.
  "Document Migration Report"
];

// Settings and lists the clinic set up — kept, so a new book is usable at once.
var KEEP_TABS = [
  "Clinic Profile", "Doctors", "Employees", "Chairs", "Treatments",
  "Procedure Library", "Payment Modes", "Expense Categories",
  "Document Categories", "Appointment Reasons", "Clinical Note Templates",
  "Medicines Master", "Medicine Dosages", "Medicine Frequencies",
  "Medicine Durations", "Medicine Instructions", "Medicine Notes",
  "Implant Brands",
  // The live tab is "Treatments Master"; "Treatments" above is kept in case an
  // older book uses that name. Naming both means neither is cleared by
  // accident — 112 rows of the clinic's treatment list sit in this one.
  "Treatments Master", "Expense Payers"
];

function thisBook_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function rowsIn_(sh) {
  var last = sh.getLastRow();
  return last > 1 ? last - 1 : 0;   // never counts the header
}

// READ-ONLY. What is here, and what each function would do to it.
function reportInstanceData() {
  var ss = thisBook_();
  Logger.log('Book: "%s"', ss.getName());
  Logger.log("Id  : %s", ss.getId());
  if (ss.getId() === LIVE_SPREADSHEET_ID) {
    Logger.log("");
    Logger.log("*** THIS IS THE LIVE K.B. DENTAL BOOK. ***");
    Logger.log("clearBookForNewInstance will refuse to run here.");
  }
  Logger.log("");

  var wouldClear = 0, kept = 0, unlisted = [];
  Logger.log("WOULD BE CLEARED (header row kept):");
  PATIENT_DATA_TABS.forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) return;
    var n = rowsIn_(sh);
    wouldClear += n;
    if (n) Logger.log("   %s — %s row(s)", name, n);
  });
  if (!wouldClear) Logger.log("   (nothing — this book is already empty)");

  Logger.log("");
  Logger.log("WOULD BE KEPT (your lists and settings):");
  KEEP_TABS.forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) return;
    var n = rowsIn_(sh);
    kept += n;
    if (n) Logger.log("   %s — %s row(s)", name, n);
  });

  // Anything this script has not been told about is left alone, and said so.
  ss.getSheets().forEach(function (sh) {
    var name = sh.getName();
    if (PATIENT_DATA_TABS.indexOf(name) >= 0) return;
    if (KEEP_TABS.indexOf(name) >= 0) return;
    if (rowsIn_(sh)) unlisted.push(name + " (" + rowsIn_(sh) + ")");
  });
  if (unlisted.length) {
    Logger.log("");
    Logger.log("NOT IN EITHER LIST — left untouched, check these yourself:");
    unlisted.forEach(function (x) { Logger.log("   %s", x); });
  }

  Logger.log("");
  Logger.log("Totals: %s patient row(s) would go, %s row(s) of lists stay.", wouldClear, kept);
  Logger.log("To clear: set CONFIRM = \"YES\" at the top, then run clearBookForNewInstance.");
}

function clearBookForNewInstance() {
  var ss = thisBook_();

  if (ss.getId() === LIVE_SPREADSHEET_ID) {
    Logger.log('REFUSED: "%s" is the live K.B. Dental book. Nothing was changed.', ss.getName());
    Logger.log("Make a copy first, and run this inside the copy.");
    return;
  }
  if (String(CONFIRM).trim().toUpperCase() !== "YES") {
    Logger.log('Nothing was changed — CONFIRM is not set.');
    Logger.log('Book: "%s"', ss.getName());
    Logger.log("Run reportInstanceData first, check that name is the COPY, then");
    Logger.log('set CONFIRM = "YES" at the top of this file and run again.');
    return;
  }

  var cleared = 0, tabs = 0;
  PATIENT_DATA_TABS.forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) return;
    var n = rowsIn_(sh);
    if (!n) return;
    // Delete the rows rather than the sheet: the tab, its header and any
    // formatting have to survive, or the app rebuilds them inconsistently.
    sh.deleteRows(2, n);
    cleared += n;
    tabs++;
    Logger.log("   cleared %s — %s row(s)", name, n);
  });

  Logger.log("");
  Logger.log('Done. "%s" is now a blank instance.', ss.getName());
  Logger.log("%s row(s) removed across %s tab(s). Lists and settings untouched.", cleared, tabs);
  Logger.log("");
  Logger.log("Still to do by hand, because they are identity, not data:");
  Logger.log("  - Master > Clinic: name, address, phone, letterhead");
  Logger.log("  - Doctors and Employees, if this branch has different staff");
  Logger.log("  - Script Properties: APP_PASSWORD, and FINANCE_SHEET_ID /");
  Logger.log("    CLINICAL_SHEET_ID if this instance keeps those elsewhere");
  Logger.log("  - Set CONFIRM back to \"\" so this cannot be run again by accident");
}
