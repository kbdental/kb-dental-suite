// ═══════════════════════════════════════════════════════════════════════════
// PAYMENT MODE HISTORY — count the old names, then convert them
//
// The app used two payment-mode lists that did not match. The clinic settled
// on one: Cash, UPI / GPay, NEFT/RTGS, Cheque, Card, N/A. Two old names go:
//     "Net Banking"  ->  "NEFT/RTGS"
//     "UPI"          ->  "UPI / GPay"
//
// WHY THIS IS NOT A FIND-AND-REPLACE. In the finance book the Mode column
// decides which amount column a payment lands in — CASH, QR Code, NEFT/RTGS,
// Cheque, SWIPE — and the monthly Total sheets add those columns up. If any
// formula anywhere matches on the TEXT "UPI" or "Net Banking" (a SUMIF, a
// QUERY, an IF), renaming it silently changes a month's collection figure and
// nothing on screen says so.
//
// So: this counts first, scans every formula in the book for those words, and
// REFUSES to convert while any formula depends on them. Money is not worth
// being brave with.
//
//   reportPaymentModeUsage   READ-ONLY. Every tab and column holding the old
//                            names, with counts, plus any formula that would
//                            be affected. Run this first, in BOTH books.
//   convertPaymentModeHistory
//                            Rewrites the cells. Refuses if a formula matched.
//
// Run it in the PMS book and in the Finance book — the Mode columns live in
// both, and in the Finance book they are spread over the FY tabs.
// ═══════════════════════════════════════════════════════════════════════════

var CONFIRM_CONVERT = "";

// Old name -> new name. Matched on the whole trimmed cell, case-insensitively,
// never as a substring: "UPI" must not touch a cell reading "UPI / GPay" that
// is already correct, nor "UPI to Dr Mittel" in a remarks column.
var MODE_RENAMES = { "net banking": "NEFT/RTGS", "upi": "UPI / GPay" };

// Only columns that actually hold a payment mode. Without this the scan would
// also rewrite the word "UPI" sitting in a Remarks note, which is prose, not a
// mode, and nobody asked for it to be edited.
var MODE_HEADERS = ["mode", "payment mode", "mode of payment", "mode of expense",
                    "payment mode (payment mode is more than one)"];

function book_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function modeColumns_(sh) {
  if (sh.getLastRow() < 1 || sh.getLastColumn() < 1) return [];
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var cols = [];
  for (var c = 0; c < head.length; c++) {
    var h = String(head[c] || "").trim().toLowerCase();
    // Headers are truncated in some tabs, so match on the start as well.
    for (var k = 0; k < MODE_HEADERS.length; k++) {
      if (h === MODE_HEADERS[k] || h.indexOf(MODE_HEADERS[k]) === 0) { cols.push(c + 1); break; }
    }
  }
  return cols;
}

// Column headings the clinic wants to rename so the sheet's vocabulary matches
// the one payment-mode list: QR Code is where UPI money lands, SWIPE is where
// card money lands. Nothing in the app reads these — it only ever writes to
// "Patient Fee Receipt" and reads "Receipt No." and "Expenses", and the
// headers it looks for there are date, uhid, mode, fee, amount and the rest.
// Everything else in this book is the spreadsheet's own formulas, which is
// exactly what has to be checked before renaming anything.
var HEADER_RENAMES = { "QR Code": "UPI / GPay", "SWIPE": "Card" };

// Any formula mentioning a word that is about to change, anywhere in the book.
function headerFormulasAtRisk_(ss) {
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
        Object.keys(HEADER_RENAMES).forEach(function (h) {
          if (new RegExp('["\']\\s*' + h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '[^"\']*["\']', "i").test(t)) {
            hits.push(h + "  " + sh.getName() + "!" + sh.getRange(r + 1, c + 1).getA1Notation() +
              "  " + t.slice(0, 80));
          }
        });
      }
    }
  });
  return hits;
}

// Any formula mentioning an old name, anywhere in the book.
function formulasAtRisk_(ss) {
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
        // Either quote style. A QUERY writes its literals in single quotes
        // (QUERY(A:D,"select D where D = 'UPI'")), and that is precisely the
        // kind of formula that silently re-totals a month — so looking only
        // for double quotes would have missed the worst case.
        //
        // The quotes are part of the match on purpose: it finds a literal
        // "UPI" but not a formula already referring to "UPI / GPay", which is
        // correct already and unaffected by the rename.
        if (/["']\s*net\s*banking\s*["']/i.test(t) || /["']\s*upi\s*["']/i.test(t)) {
          hits.push(sh.getName() + "!" + sh.getRange(r + 1, c + 1).getA1Notation() + "  " + t.slice(0, 90));
        }
      }
    }
  });
  return hits;
}

function scan_(ss) {
  var found = [];     // {sheet, col, header, old, count}
  ss.getSheets().forEach(function (sh) {
    var cols = modeColumns_(sh);
    if (!cols.length || sh.getLastRow() < 2) return;
    var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    cols.forEach(function (c) {
      var vals = sh.getRange(2, c, sh.getLastRow() - 1, 1).getValues();
      var counts = {};
      vals.forEach(function (row) {
        var key = String(row[0] || "").trim().toLowerCase();
        if (MODE_RENAMES[key]) counts[key] = (counts[key] || 0) + 1;
      });
      Object.keys(counts).forEach(function (k) {
        found.push({ sheet: sh.getName(), col: c, header: String(head[c - 1] || "").trim(),
                     old: k, count: counts[k] });
      });
    });
  });
  return found;
}

// READ-ONLY.
function reportPaymentModeUsage() {
  var ss = book_();
  Logger.log('Book: "%s"', ss.getName());
  Logger.log("");

  var found = scan_(ss);
  if (!found.length) {
    Logger.log('No cell in a payment-mode column reads "Net Banking" or "UPI".');
    Logger.log("Nothing to convert in this book.");
  } else {
    Logger.log("CELLS THAT WOULD BE REWRITTEN:");
    var total = 0;
    found.forEach(function (f) {
      Logger.log('   %s  [%s]  "%s" -> "%s"  %s row(s)',
        f.sheet, f.header, f.old, MODE_RENAMES[f.old], f.count);
      total += f.count;
    });
    Logger.log("");
    Logger.log("Total: %s cell(s) across %s column(s).", total, found.length);
  }

  // The column headings, which the clinic wants to rename by hand.
  var hdr = headerFormulasAtRisk_(ss);
  Logger.log("");
  Logger.log("RENAMING THE COLUMN HEADINGS (QR Code -> UPI / GPay, SWIPE -> Card):");
  if (!hdr.length) {
    Logger.log("   No formula in this book refers to those headings by name, so");
    Logger.log("   renaming them changes nothing but the words on screen.");
  } else {
    Logger.log("   *** %s formula(s) refer to them by name — renaming would break", hdr.length);
    Logger.log("   these. Send this log to Claude before renaming: ***");
    hdr.slice(0, 20).forEach(function (h) { Logger.log("      %s", h); });
    if (hdr.length > 20) Logger.log("      ... and %s more", hdr.length - 20);
  }

  var risky = formulasAtRisk_(ss);
  Logger.log("");
  if (!risky.length) {
    Logger.log("No formula in this book matches on those words, so renaming them");
    Logger.log("cannot change any total.");
    if (found.length) {
      Logger.log("");
      Logger.log('To convert: set CONFIRM_CONVERT = "YES" at the top, then run');
      Logger.log("convertPaymentModeHistory.");
    }
  } else {
    Logger.log("*** STOP — %s formula(s) match on the old names: ***", risky.length);
    risky.slice(0, 25).forEach(function (h) { Logger.log("   %s", h); });
    if (risky.length > 25) Logger.log("   ... and %s more", risky.length - 25);
    Logger.log("");
    Logger.log("Renaming the cells would change what these add up, and a month's");
    Logger.log("collection figure would move with nothing on screen to say so.");
    Logger.log("convertPaymentModeHistory will refuse while these exist.");
    Logger.log("Send this log to Claude — the formulas are fixed first.");
  }
}

function convertPaymentModeHistory() {
  var ss = book_();
  if (String(CONFIRM_CONVERT).trim().toUpperCase() !== "YES") {
    Logger.log("Nothing was changed — CONFIRM_CONVERT is not set.");
    Logger.log('Book: "%s"', ss.getName());
    Logger.log('Run reportPaymentModeUsage first, then set CONFIRM_CONVERT = "YES".');
    return;
  }
  var risky = formulasAtRisk_(ss);
  if (risky.length) {
    Logger.log("REFUSED: %s formula(s) in this book match on the old names.", risky.length);
    risky.slice(0, 10).forEach(function (h) { Logger.log("   %s", h); });
    Logger.log("");
    Logger.log("Renaming the cells would change what they add up. Nothing was changed.");
    Logger.log("Run reportPaymentModeUsage for the full list.");
    return;
  }

  var changed = 0, cols = 0;
  ss.getSheets().forEach(function (sh) {
    var mc = modeColumns_(sh);
    if (!mc.length || sh.getLastRow() < 2) return;
    mc.forEach(function (c) {
      var rng = sh.getRange(2, c, sh.getLastRow() - 1, 1);
      var vals = rng.getValues();
      var touched = 0;
      for (var i = 0; i < vals.length; i++) {
        var key = String(vals[i][0] || "").trim().toLowerCase();
        if (MODE_RENAMES[key]) { vals[i][0] = MODE_RENAMES[key]; touched++; }
      }
      if (!touched) return;
      rng.setValues(vals);
      changed += touched; cols++;
      Logger.log("   %s [col %s] — %s cell(s)", sh.getName(), c, touched);
    });
  });

  Logger.log("");
  if (!changed) { Logger.log("Nothing matched. No cell was changed."); return; }
  Logger.log('Done. %s cell(s) rewritten across %s column(s) in "%s".', changed, cols, ss.getName());
  Logger.log("Only the mode wording changed — no amount, date or column was touched.");
  Logger.log('Set CONFIRM_CONVERT back to "" so this cannot run again by accident.');
}
