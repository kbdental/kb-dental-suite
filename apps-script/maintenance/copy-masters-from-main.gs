// ═══════════════════════════════════════════════════════════════════════════
// COPY THE MASTER LISTS INTO A NEW INSTANCE
//
// A book copied from the PMS and then cleared keeps most of its Master lists,
// but some come across empty — Doctors, Chairs, Payment Modes and the rest.
// The empanelled book is the same clinic with the same staff and the same
// chairs, so those lists should be copied rather than retyped.
//
// PASTE THIS INTO THE NEW BOOK (the empanelled one), not the main one. It
// PULLS from main; it never writes to it, and it refuses to run there at all.
//
//   reportMastersGap        READ-ONLY. For each Master list, how many rows are
//                           here and how many are in main. Run this first.
//   copyMastersFromMainBook Fills ONLY the lists that are empty or missing
//                           here. A list that already has rows is never
//                           touched, so anything already set up in this book —
//                           its own Clinic Profile above all — survives.
//
// This file is self-contained and shares no names with Code.gs or with
// new-instance-reset.gs, so all three can sit alongside each other.
// ═══════════════════════════════════════════════════════════════════════════

// Where the lists are copied FROM. Read-only throughout this file.
var SOURCE_BOOK_ID = "1DtoZ3MNFq2Enr-ClAjENWFzk8SF2dYN9e1nGf7tAJC4";  // K. B. DENTAL SUITE - PMS

// Typing this into CONFIRM_MASTERS is what allows the copy to happen.
var CONFIRM_MASTERS = "";

// The lists worth carrying into a new instance. Patient data is never here.
var MASTER_TABS = [
  "Doctors", "Employees", "Chairs", "Payment Modes", "Appointment Reasons",
  "Medicine Notes", "Implant Brands",
  // Listed so the report shows them too. They normally survive the clear, so
  // they will already have rows here and will be left alone.
  "Treatments Master", "Procedure Library", "Clinical Note Templates",
  "Medicines Master", "Medicine Dosages", "Medicine Frequencies",
  "Medicine Durations", "Medicine Instructions",
  "Expense Categories", "Expense Payers", "Document Categories"
];

// Deliberately NOT copied. This is the new instance's own identity, and
// overwriting it would put K. B. Dental's letterhead on empanelled paperwork.
var NEVER_COPY = ["Clinic Profile"];

function here_() { return SpreadsheetApp.getActiveSpreadsheet(); }
function rows_(sh) { var n = sh ? sh.getLastRow() : 0; return n > 1 ? n - 1 : 0; }

function refusesToRunHere_() {
  var ss = here_();
  if (ss.getId() !== SOURCE_BOOK_ID) return false;
  Logger.log('REFUSED: "%s" is the source book itself.', ss.getName());
  Logger.log("This script is pasted into the NEW instance and pulls from main.");
  return true;
}

// READ-ONLY. What is here, what is in main, and what would be copied.
function reportMastersGap() {
  if (refusesToRunHere_()) return;
  var to = here_(), from = SpreadsheetApp.openById(SOURCE_BOOK_ID);
  Logger.log('Into  : "%s"', to.getName());
  Logger.log('From  : "%s"', from.getName());
  Logger.log("");

  var would = [];
  Logger.log("%s  %s  %s", pad_("LIST", 26), pad_("HERE", 8), "IN MAIN");
  MASTER_TABS.forEach(function (name) {
    var mine = to.getSheetByName(name), theirs = from.getSheetByName(name);
    var a = rows_(mine), b = rows_(theirs);
    var note = "";
    if (!theirs) note = "   not in main — nothing to copy";
    else if (!b) note = "   empty in main too";
    else if (a > 0) note = "   already filled here, left alone";
    else { note = "   WOULD COPY " + b + " row(s)"; would.push(name); }
    Logger.log("%s  %s  %s%s", pad_(name, 26), pad_(String(a), 8), pad_(String(b), 7), note);
  });

  Logger.log("");
  NEVER_COPY.forEach(function (name) {
    Logger.log("%s is never copied — it is this book's own identity.", name);
  });
  Logger.log("");
  if (!would.length) {
    Logger.log("Nothing to copy. Every list here either has rows already or has none in main.");
    return;
  }
  Logger.log("Would fill %s list(s): %s", would.length, would.join(", "));
  Logger.log('To do it: set CONFIRM_MASTERS = "YES" at the top, then run copyMastersFromMainBook.');
}

function pad_(s, n) { s = String(s); while (s.length < n) s += " "; return s; }

function copyMastersFromMainBook() {
  if (refusesToRunHere_()) return;
  var to = here_();
  if (String(CONFIRM_MASTERS).trim().toUpperCase() !== "YES") {
    Logger.log("Nothing was changed — CONFIRM_MASTERS is not set.");
    Logger.log('Book: "%s"', to.getName());
    Logger.log("Run reportMastersGap first, then set CONFIRM_MASTERS = \"YES\" and run again.");
    return;
  }
  var from = SpreadsheetApp.openById(SOURCE_BOOK_ID);
  var filled = 0, lists = 0;

  MASTER_TABS.forEach(function (name) {
    if (NEVER_COPY.indexOf(name) >= 0) return;
    var src = from.getSheetByName(name);
    if (!src || rows_(src) === 0) return;

    var dst = to.getSheetByName(name);
    // A list that already has rows is this book's own. Never overwrite it.
    if (dst && rows_(dst) > 0) return;
    if (!dst) dst = to.insertSheet(name);

    var r = src.getLastRow(), c = src.getLastColumn();
    var values = src.getRange(1, 1, r, c).getValues();
    dst.getRange(1, 1, r, c).setValues(values);   // header row included
    filled += r - 1;
    lists++;
    Logger.log("   filled %s — %s row(s)", name, r - 1);
  });

  Logger.log("");
  if (!lists) { Logger.log("Nothing needed filling. No list was changed."); return; }
  Logger.log("Done. %s row(s) copied into %s list(s). Nothing in the main book was touched.", filled, lists);
  Logger.log("");
  Logger.log("Still yours to set, because they are identity, not lists:");
  Logger.log("  - Master > Clinic: name, address, phone, letterhead");
  Logger.log("  - Remove any doctor or employee who does not work on these cases");
  Logger.log('  - Set CONFIRM_MASTERS back to "" so this cannot run again by accident');
}
