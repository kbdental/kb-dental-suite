// ═══════════════════════════════════════════════════════════════════════════
// FINANCE SHEET — rename the column headings to match the payment modes
//
// The finance workbook names its amount columns after how the money arrived:
// CASH, QR Code, NEFT/RTGS, Cheque, SWIPE. Two of those are a second
// vocabulary beside the payment-mode list the clinic settled on, so the same
// payment is called one thing in Mode and another at the top of the column
// its amount lands in.
//
//     "QR Code"  ->  "UPI / GPay"
//     "SWIPE"    ->  "Card"
//
// including the longer forms built on them — "QR Code Collection",
// "SWIPE Amount", "SWIPE Received", "SWIPED Amount Total".
//
// THIS IS SAFE IN A WAY THE MODE CELLS WERE NOT. The Mode CELLS could not be
// renamed: 2,801 formulas test for the literal "UPI" to decide which column a
// payment lands in, and renaming would have zeroed every UPI collection. The
// HEADINGS are read by nobody — not by the formulas, and not by the app,
// which only ever writes to "Patient Fee Receipt" and reads "Receipt No." and
// "Expenses" by quite different header names. These are words on screen.
//
// It still checks before it writes, because "nobody reads it" is a claim
// about a book that changes.
//
//   reportHeadingRenames   READ-ONLY. Every heading that would change, with
//                          its sheet and cell, and any formula referring to
//                          one by name. Run this first.
//   renameFinanceHeadings  Rewrites those cells. Refuses if a formula refers
//                          to a heading being changed.
//
// Only row 1 of each tab is touched — the header row. No data cell, no
// formula and no amount is altered.
// ═══════════════════════════════════════════════════════════════════════════

// Blank in a project opened from the spreadsheet; the id in a standalone one.
//   Finance workbook : 1Zdxq3Xf-e41Xak4VDcufrURLkKDAp8MvRCZadC0htUI
var HEADING_TARGET_SHEET_ID = "";

var CONFIRM_HEADINGS = "";

// Longest first, so "SWIPED" is handled before "SWIPE" would half-match it.
var HEADING_WORDS = [
  { from: "QR Code", to: "UPI / GPay" },
  { from: "SWIPED",  to: "Card" },
  { from: "SWIPE",   to: "Card" }
];

function headingBook_() {
  if (String(HEADING_TARGET_SHEET_ID).trim()) {
    return SpreadsheetApp.openById(String(HEADING_TARGET_SHEET_ID).trim());
  }
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  throw new Error(
    "This project is not attached to a spreadsheet.\n\n" +
    "Set HEADING_TARGET_SHEET_ID at the top of this file to the finance book:\n" +
    "  1Zdxq3Xf-e41Xak4VDcufrURLkKDAp8MvRCZadC0htUI");
}

// The new text for a heading, or null when nothing in it changes.
function renamedHeading_(text) {
  var s = String(text == null ? "" : text);
  if (!s.trim()) return null;
  var out = s;
  for (var i = 0; i < HEADING_WORDS.length; i++) {
    var w = HEADING_WORDS[i];
    var re = new RegExp(w.from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    if (re.test(out)) out = out.replace(re, w.to);
  }
  return out === s ? null : out;
}

function headingChanges_(ss) {
  var out = [];
  ss.getSheets().forEach(function (sh) {
    if (sh.getLastRow() < 1 || sh.getLastColumn() < 1) return;
    var head = sh.getRange(1, 1, 1, sh.getLastColumn());
    var vals = head.getValues()[0];
    // A heading produced by a formula is not ours to overwrite with text.
    var fx = head.getFormulas()[0];
    for (var c = 0; c < vals.length; c++) {
      var to = renamedHeading_(vals[c]);
      if (!to) continue;
      out.push({ sheet: sh.getName(), sheetObj: sh, col: c + 1,
                 from: String(vals[c]), to: to, isFormula: !!fx[c] });
    }
  });
  return out;
}

// Any formula naming a heading that is about to change.
function headingFormulasAtRisk_(ss) {
  var hits = [];
  ss.getSheets().forEach(function (sh) {
    var last = sh.getLastRow(), lastC = sh.getLastColumn();
    if (!last || !lastC) return;
    var f;
    try { f = sh.getRange(1, 1, last, lastC).getFormulas(); } catch (e) { return; }
    for (var r = 0; r < f.length; r++) {
      for (var c = 0; c < f[r].length; c++) {
        var t = String(f[r][c] || "");
        if (!t) continue;
        for (var i = 0; i < HEADING_WORDS.length; i++) {
          var w = HEADING_WORDS[i].from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          if (new RegExp('["\']\\s*' + w, "i").test(t)) {
            hits.push(HEADING_WORDS[i].from + "  " + sh.getName() + "!" +
              sh.getRange(r + 1, c + 1).getA1Notation() + "  " + t.slice(0, 80));
            break;
          }
        }
      }
    }
  });
  return hits;
}

// READ-ONLY. Every tab, and exactly what its row 1 holds.
//
// Added because a dry run listed FY 2024-25 and FY 2025-26 but not FY 2026-27,
// though that tab has the same columns. Converting on that basis would have
// renamed the older years and left the CURRENT one alone, which is worse than
// not starting. A heading that does not match is usually spelled differently,
// sits on another row, or is a formula — and guessing which is how a careful
// change becomes a careless one.
function listAllHeadings() {
  var ss = headingBook_();
  Logger.log('Book: "%s"', ss.getName());
  Logger.log("Tabs: %s", ss.getSheets().length);
  Logger.log("");
  ss.getSheets().forEach(function (sh) {
    var rows = sh.getLastRow(), cols = sh.getLastColumn();
    Logger.log("──── %s   (%s rows x %s cols)", sh.getName(), rows, cols);
    if (!rows || !cols) { Logger.log("     empty"); return; }
    // Row 1 and row 2 both: a tab with a title bar keeps its headings lower.
    for (var r = 1; r <= Math.min(2, rows); r++) {
      var vals = sh.getRange(r, 1, 1, cols).getValues()[0];
      var fx = sh.getRange(r, 1, 1, cols).getFormulas()[0];
      var parts = [];
      for (var c = 0; c < vals.length; c++) {
        var v = String(vals[c] == null ? "" : vals[c]);
        if (!v.trim() && !fx[c]) continue;
        // The quotes make a trailing space or a non-breaking space visible,
        // which is the usual reason a heading does not match.
        parts.push((c + 1) + ':"' + v + '"' + (fx[c] ? "{=}" : ""));
      }
      Logger.log("   row %s: %s", r, parts.length ? parts.join("  ") : "(blank)");
    }
  });
  Logger.log("");
  Logger.log("Nothing has been changed.");
}

// READ-ONLY.
function reportHeadingRenames() {
  var ss = headingBook_();
  Logger.log('Book: "%s"', ss.getName());
  Logger.log("Id  : %s", ss.getId());
  Logger.log("");

  var changes = headingChanges_(ss);
  if (!changes.length) {
    Logger.log("No heading in this book contains QR Code or SWIPE. Nothing to do.");
  } else {
    Logger.log("HEADINGS THAT WOULD CHANGE:");
    changes.forEach(function (c) {
      Logger.log('   %s  col %s:  "%s"  ->  "%s"%s',
        c.sheet, c.col, c.from, c.to, c.isFormula ? "   [SKIPPED — it is a formula]" : "");
    });
    var writable = changes.filter(function (c) { return !c.isFormula; }).length;
    Logger.log("");
    Logger.log("%s heading(s) would be rewritten; %s left alone as formulas.",
      writable, changes.length - writable);
  }

  var risky = headingFormulasAtRisk_(ss);
  Logger.log("");
  if (!risky.length) {
    Logger.log("No formula refers to those headings by name, so renaming them");
    Logger.log("changes nothing but the words on screen. No amount or total moves.");
    if (changes.length) {
      Logger.log("");
      Logger.log('To do it: set CONFIRM_HEADINGS = "YES", then run renameFinanceHeadings.');
    }
  } else {
    Logger.log("*** STOP — %s formula(s) refer to those headings: ***", risky.length);
    risky.slice(0, 20).forEach(function (h) { Logger.log("   %s", h); });
    if (risky.length > 20) Logger.log("   ... and %s more", risky.length - 20);
    Logger.log("renameFinanceHeadings will refuse. Send this log to Claude.");
  }
  Logger.log("");
  Logger.log("Nothing has been changed.");
}

function renameFinanceHeadings() {
  var ss = headingBook_();
  if (String(CONFIRM_HEADINGS).trim().toUpperCase() !== "YES") {
    Logger.log("Nothing was changed — CONFIRM_HEADINGS is not set.");
    Logger.log('Book: "%s"  (%s)', ss.getName(), ss.getId());
    Logger.log('Run reportHeadingRenames first, then set CONFIRM_HEADINGS = "YES".');
    return;
  }
  var risky = headingFormulasAtRisk_(ss);
  if (risky.length) {
    Logger.log("REFUSED: %s formula(s) refer to a heading being renamed.", risky.length);
    risky.slice(0, 10).forEach(function (h) { Logger.log("   %s", h); });
    Logger.log("Nothing was changed. Run reportHeadingRenames for the full list.");
    return;
  }

  var done = 0;
  headingChanges_(ss).forEach(function (c) {
    if (c.isFormula) return;
    c.sheetObj.getRange(1, c.col).setValue(c.to);
    Logger.log('   %s col %s:  "%s" -> "%s"', c.sheet, c.col, c.from, c.to);
    done++;
  });

  Logger.log("");
  if (!done) { Logger.log("Nothing needed changing."); return; }
  Logger.log('Done. %s heading(s) renamed in "%s".', done, ss.getName());
  Logger.log("Only row 1 was touched — no data cell, formula or amount was altered.");
  Logger.log('Set CONFIRM_HEADINGS back to "" so this cannot run again by accident.');
}
