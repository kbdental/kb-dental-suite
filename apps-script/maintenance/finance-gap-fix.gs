// ═══════════════════════════════════════════════════════════════════════════
// CLOSE THE BLANK GAP IN THE FINANCE SHEET
//
// HOW TO USE
//   1. Open any Apps Script project (script.google.com — a brand new empty
//      one is fine) and paste this whole file into it. Save (Ctrl+S).
//   2. Function dropdown -> reportFinanceGaps -> Run -> open Execution log.
//      This CHANGES NOTHING. It only tells you what is there.
//   3. If the numbers look right, run closeFinanceGaps.
//      It deletes ONLY blank rows. Every row carrying data is kept.
//
// This file is deliberately self-contained — it shares no names with the
// clinic's main Code.gs, so it can be pasted anywhere (including alongside
// Code.gs) without clashing with or depending on anything already there.
//
// WHY THE GAP KEEPS COMING BACK
//   An old bug wrote receipts far below the real data, leaving hundreds of
//   blank rows in between. The gap is self-perpetuating: the clinic's Google
//   Form appends below the last row containing ANYTHING, so every new
//   response lands under the stranded block and the hole is preserved.
//   Deleting it in the FY tabs does nothing — those read from Working, so it
//   returns on the next recalculation. It has to be closed in the two source
//   tabs, which is what this does.
// ═══════════════════════════════════════════════════════════════════════════

// The finance workbook. Falls back to the known ID when the script has no
// FINANCE_SHEET_ID property set (which is the case in a fresh project).
var GAPFIX_DEFAULT_SHEET_ID = "1Zdxq3Xf-e41Xak4VDcufrURLkKDAp8MvRCZadC0htUI";

// The two tabs the clinic and the app actually write into. The FY tabs are
// deliberately absent: they are derived from Working, so editing them is
// what made this look unfixable three times over.
var GAPFIX_TABS = ["Patient Fee Receipt", "Working"];

function gapfixSheetId_() {
  var stored = PropertiesService.getScriptProperties().getProperty("FINANCE_SHEET_ID");
  return stored || GAPFIX_DEFAULT_SHEET_ID;
}

// Finds a column by header name, tolerating the sheet's own spelling
// (trailing spaces, apostrophes, casing). Returns -1 when absent.
function gapfixCol_(headers, name) {
  var norm = function(x) { return String(x).toLowerCase().replace(/[^a-z0-9]/g, ""); };
  var want = norm(name);
  for (var i = 0; i < headers.length; i++) {
    if (norm(headers[i]) === want) return i;
  }
  return -1;
}

// Two kinds of column lie about a row being used, and both must be ignored
// when deciding whether a row is blank:
//   Date/Time — ARRAYFORMULA spill. This is what made getLastRow() report
//     rows that nobody had typed into, and caused the original corruption.
//   Checked   — a checkbox column. Google stores an unticked box as a real
//     `false`, so every formatted-but-empty row would read as data and no
//     gap in the entry tab could ever be closed.
function gapfixDataWidth_(headers) {
  var width = headers.length;
  ["Date", "Time", "Checked"].forEach(function(name) {
    var c = gapfixCol_(headers, name);
    if (c >= 0 && c < width) width = c;
  });
  return width;
}

// `false` counts as empty, for the checkbox reason above. A genuine 0 does
// not — a zero-amount receipt is still a receipt and must never be deleted.
function gapfixCellEmpty_(v) {
  return v === "" || v === null || v === undefined || v === false;
}

function gapfixScanTab_(tabName) {
  var sh = SpreadsheetApp.openById(gapfixSheetId_()).getSheetByName(tabName);
  if (!sh) throw new Error("The '" + tabName + "' tab was not found in the finance sheet.");
  var lastRow = sh.getLastRow();
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  var width = gapfixDataWidth_(headers);

  var filled = [];                                   // 1-based rows carrying data
  if (lastRow > 1 && width > 0) {
    var vals = sh.getRange(1, 1, lastRow, width).getValues();
    for (var i = 1; i < vals.length; i++) {          // skip the header row
      if (!vals[i].every(gapfixCellEmpty_)) filled.push(i + 1);
    }
  }
  // Only blank runs sitting BETWEEN two data rows count. Trailing blanks below
  // the last data row are just unused sheet, and deleting those is busywork.
  var gaps = [];
  for (var k = 1; k < filled.length; k++) {
    var prev = filled[k - 1], cur = filled[k];
    if (cur - prev > 1) gaps.push({ start: prev + 1, end: cur - 1, count: cur - prev - 1 });
  }
  return { tabName: tabName, sheet: sh, headers: headers, width: width,
           lastRow: lastRow, filled: filled, gaps: gaps };
}

// ── Read-only. Run this first and read the Execution log. ─────────────────
function reportFinanceGaps() {
  Logger.log("Finance sheet: %s", gapfixSheetId_());
  GAPFIX_TABS.forEach(function(tabName) {
    Logger.log("──────── %s ────────", tabName);
    var s = gapfixScanTab_(tabName);
    Logger.log("getLastRow() says %s rows; %s of them carry real data.", s.lastRow, s.filled.length);
    Logger.log("Checked columns 1..%s of %s (ignoring any Date/Time/Checked columns).",
      s.width, s.headers.length);
    if (!s.filled.length) { Logger.log("No data rows at all — nothing to do."); return; }
    Logger.log("First data row: %s.  Last data row: %s.", s.filled[0], s.filled[s.filled.length - 1]);
    if (!s.gaps.length) { Logger.log("No blank gaps between data rows. Nothing to close."); return; }
    var total = 0;
    s.gaps.forEach(function(g) {
      total += g.count;
      Logger.log("GAP: rows %s-%s (%s blank rows) sit between data rows.", g.start, g.end, g.count);
    });
    Logger.log("Blank rows closeFinanceGaps() would delete here: %s", total);
  });
  Logger.log("Nothing has been changed. Run closeFinanceGaps() to delete exactly those rows.");
}

// ── Deletes only the blank rows the report listed, bottom-up so the row ────
// ── numbers above each deletion stay valid as it goes. ─────────────────────
function closeFinanceGaps() {
  GAPFIX_TABS.forEach(function(tabName) {
    Logger.log("──────── %s ────────", tabName);
    var s = gapfixScanTab_(tabName);
    if (!s.gaps.length) { Logger.log("No blank gaps between data rows. Nothing deleted."); return; }
    var deleted = 0;
    for (var i = s.gaps.length - 1; i >= 0; i--) {
      var g = s.gaps[i];
      s.sheet.deleteRows(g.start, g.count);
      deleted += g.count;
      Logger.log("Deleted rows %s-%s (%s blank rows).", g.start, g.end, g.count);
    }
    Logger.log("%s blank rows deleted; every row carrying data was kept.", deleted);
  });
  Logger.log("Done. Re-run reportFinanceGaps() to confirm no gaps remain.");
}
