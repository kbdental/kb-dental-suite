#!/usr/bin/env node
//
// Applies the three Code.gs changes to your own file, so nothing is retyped.
//
//   node apps-script/apply-patch.js path/to/Code.gs
//
// Writes Code.patched.gs beside it and prints a summary. Every anchor must
// match exactly once — if one does not, nothing is written and it says which,
// which is the point: a silent near-miss on a live clinic backend is the thing
// worth avoiding.

const fs = require('fs');
const path = require('path');

const EDITS = [
  {
    name: 'savePathology — store the Remarks it discards',
    find: `      "Follow-up Action": p.followupAction || ""
    }`,
    replace: `      "Follow-up Action": p.followupAction || "",
      "Remarks": p.remarks || ""
    }`,
  },
  {
    name: 'saveRadiology — store the Remarks it discards',
    find: `      "Follow-up Recommendation": p.followupRecommendation || ""
    }`,
    replace: `      "Follow-up Recommendation": p.followupRecommendation || "",
      "Remarks": p.remarks || ""
    }`,
  },
  {
    name: 'saveToDailyRegister — stop answering two compliance questions',
    find: `  setBy(row, ["initial assessment done","initial assessment"], p.initialAssessment || "Yes");
  setBy(row, ["care plan documented","care plan"], p.carePlanDocumented || "Yes");`,
    replace: `  // An unanswered question stays blank. These are compliance answers, and
  // the register should not be giving them on the clinic's behalf.
  setBy(row, ["initial assessment done","initial assessment"], p.initialAssessment || "");
  setBy(row, ["care plan documented","care plan"], p.carePlanDocumented || "");`,
  },
  {
    // Harmless today — the alias before the | matches the real column and is
    // tried first — but it is a find-and-replace that went through the wrong
    // buffer, and it should not be left sitting in the file.
    name: 'patientCompleteRegistration — repair corrupted alias string',
    find: '"In Case Of Emergency Contact Number|Emergency Covar PUBLIC_ACTIONStact"',
    replace: '"In Case Of Emergency Contact Number|Emergency Contact"',
  },
  {
    name: 'fmtTime — format in the spreadsheet timezone, not the script one',
    find: `    var d = new Date(val);
    if (!isNaN(d.getTime())) {
      var hh = String(d.getHours()).padStart(2, "0");
      var mm = String(d.getMinutes()).padStart(2, "0");
      return hh + ":" + mm;
    }`,
    replace: `    var d = new Date(val);
    if (!isNaN(d.getTime())) {
      // Format in the SPREADSHEET's timezone rather than via getHours(), which
      // reads in the script's. The two are normally both IST, but nothing
      // enforces that — and a time-of-day cell read back from Sheets is a Date
      // on the 1899-12-30 epoch, so any mismatch silently shifts every
      // check-in and check-out by the offset.
      var tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
      return Utilities.formatDate(d, tz, "HH:mm");
    }`,
  },
  {
    name: 'getAppointments — format check-in / engaged / check-out times',
    find: `        checkinTime: row[col("CheckinTime")] || "", engagedTime: row[col("EngagedTime")] || "",
        checkoutTime: row[col("CheckoutTime")] || "", cancelReason: row[col("CancelReason")] || ""`,
    replace: `        // Sheets turns an "HH:MM" write into a time-of-day cell, which reads
        // back as a Date on the 1899-12-30 epoch. Passed through raw these
        // reached the browser as "1899-12-30T05:35:50.000Z" instead of a time.
        checkinTime: fmtTime(row[col("CheckinTime")]), engagedTime: fmtTime(row[col("EngagedTime")]),
        checkoutTime: fmtTime(row[col("CheckoutTime")]), cancelReason: row[col("CancelReason")] || ""`,
  },
  {
    name: 'FINANCE_SHEET_ID_DEFAULT — point at K. B. Dental - Finance Sheet PMS',
    find: "var FINANCE_SHEET_ID_DEFAULT = \"1Zdxq3Xf-e41Xak4VDcufrURLkKDAp8MvRCZadC0htUI\";",
    replace: "var FINANCE_SHEET_ID_DEFAULT = \"1zi5xjxGaVVtCMNGYiqxNrhppUv1eswPsJGdp4P-DGmM\"; // K. B. Dental - Finance Sheet PMS",
  },
  {
    name: 'saveReceipt — write to Patient Fee Receipt, mirror into Working',
    find: "function saveReceipt(p) {\n  try {\n    var sh = getFinanceSheet(\"Working\", true); // the one place allowed to create it\n    if (!sh) return { success: false, error: \"Finance 'Working' tab not found\" };\n    if (sh.getLastRow() === 0) {\n      sh.appendRow([\n        \"Timestamp\", \"UHID\", \"Patient's Name\", \"Nature of Professional Services\",\n        \"Payment Mode\", \"Amount\",\n        \"Payment Mode (Payment mode is more than one)\", \"Amount (Payment mode is more than one)\",\n        \"Remarks (If any)\"\n      ]);\n    }\n    var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);\n    var now = new Date();\n    var receiptDate = p.date ? new Date(p.date) : now;\n    var row = headers.map(function(h) {\n      var hl = h.trim().toLowerCase();\n      // Must be a real Date, not an ISO string: the \"Receipt No.\" tab derives\n      // its values from this one by formula, and a text timestamp where a date\n      // is expected propagates as #VALUE! down every dependent column.\n      if (hl === \"timestamp\") return now;\n      if (hl === \"date\") return receiptDate;\n      if (hl === \"time\") return now;\n      // Distinguish primary vs \"more than one\" duplicate headers.\n      // Match on what the header STARTS with, not on substring presence: the\n      // split-payment amount column is literally named\n      //   \"Amount (Payment mode is more than one)\"\n      // which contains BOTH \"amount\" and \"payment mode\". A substring test hits\n      // the payment-mode branch first and writes a mode STRING into the numeric\n      // Amount column, which then breaks every dependent formula as #VALUE!.\n      var isSecondary = hl.indexOf(\"more than one\") >= 0;\n      if (hl.indexOf(\"amount\") === 0) return (isSecondary ? p.amount2 : p.amount1) || \"\";\n      if (hl.indexOf(\"payment mode\") === 0) return (isSecondary ? p.mode2 : p.mode1) || \"\";\n      if (hl.indexOf(\"uhid\") >= 0) return p.uhid || \"\";\n      if (hl.indexOf(\"patient\") >= 0 && hl.indexOf(\"name\") >= 0) return p.patientName || \"\";\n      if (hl.indexOf(\"professional services\") >= 0 || hl === \"service\") return p.service || \"\";\n      if (hl.indexOf(\"remarks\") >= 0) return p.remarks || \"\";\n      return \"\";\n    });\n    sh.appendRow(row);\n    return { success: true };\n  } catch (e) {\n    return { success: false, error: e.message };\n  }\n}\n",
    replace: "// Records a payment on the \"Patient Fee Receipt\" tab \u2014 the clinic's own entry\n// sheet, and the only one in the receipt chain with no formulas in it.\n//\n// The chain is: Patient Fee Receipt -> Working -> Receipt No. / E-Receipt / FY\n// tabs. \"Working\" is NOT formula-linked to the entry tab; columns A:H are a\n// static mirror kept alongside it, and only its Date/Time columns are\n// computed. So a row written to the entry tab alone would never reach\n// \"Receipt No.\", which is what the app reads back \u2014 the receipt would save and\n// then be invisible. Both tabs are written, and the mirror deliberately stops\n// at column H: Date and Time are an ARRAYFORMULA spilling down from row 2, and\n// writing into a spilled cell breaks the whole array.\nvar FIN_ENTRY_TAB  = \"Patient Fee Receipt\";\nvar FIN_MIRROR_TAB = \"Working\";\n\n// Finds a column by header name, tolerating the sheet's own spelling (trailing\n// spaces, \"'s\", casing). Returns -1 when absent.\nfunction finCol_(headers, candidates) {\n  var norm = function(x) { return String(x).toLowerCase().replace(/[^a-z0-9]/g, \"\"); };\n  for (var c = 0; c < candidates.length; c++) {\n    var want = norm(candidates[c]);\n    for (var i = 0; i < headers.length; i++) {\n      if (norm(headers[i]) === want) return i;\n    }\n  }\n  return -1;\n}\n\n// Builds one receipt row against whatever header order the tab actually has,\n// so neither tab depends on a fixed column position.\nfunction finReceiptRow_(headers, p, stamp) {\n  var row = headers.map(function() { return \"\"; });\n  var put = function(names, value) {\n    var i = finCol_(headers, names);\n    if (i >= 0) row[i] = value;\n  };\n  // A real Date, not an ISO string: the derived tabs split this into Date and\n  // Time by formula, and text where a date is expected propagates as #VALUE!.\n  put([\"Timestamp\"], stamp);\n  put([\"UHID\"], p.uhid || \"\");\n  put([\"Patient's Name\", \"Patient Name\"], p.patientName || \"\");\n  put([\"Nature of Professional Services\"], p.service || \"\");\n  put([\"Payment Mode\"], p.mode1 || \"\");\n  put([\"Amount\"], p.amount1 === \"\" || p.amount1 === undefined ? \"\" : Number(p.amount1));\n  put([\"Payment Mode (Payment mode is more than one)\"], p.mode2 || \"\");\n  put([\"Amount (Payment mode is more than one)\"],\n      p.amount2 === \"\" || p.amount2 === undefined ? \"\" : Number(p.amount2));\n  put([\"Remarks (If any)\", \"Remarks\"], p.remarks || \"\");\n  // \"Checked\" is the clinic's own reconciliation tick \u2014 left alone.\n  return row;\n}\n\nfunction saveReceipt(p) {\n  try {\n    var ss = SpreadsheetApp.openById(getFinanceSheetId());\n\n    var entry = ss.getSheetByName(FIN_ENTRY_TAB);\n    if (!entry) {\n      return { success: false, error: \"The '\" + FIN_ENTRY_TAB + \"' tab was not found in the finance sheet.\" };\n    }\n\n    // The receipt is dated by the entry the staff member made, not by the\n    // moment the request happened to reach the server.\n    var stamp = p.date ? new Date(p.date) : new Date();\n    if (isNaN(stamp.getTime())) stamp = new Date();\n\n    var entryHeaders = entry.getRange(1, 1, 1, entry.getLastColumn()).getValues()[0].map(String);\n    var entryRow = finReceiptRow_(entryHeaders, p, stamp);\n    entry.appendRow(entryRow);\n\n    // Mirror into Working so the derived tabs pick it up. Failing here does not\n    // lose the receipt \u2014 it is already on the entry tab \u2014 but it does mean the\n    // app will not show it yet, so say exactly that rather than reporting a\n    // clean save.\n    var mirror = ss.getSheetByName(FIN_MIRROR_TAB);\n    if (!mirror) {\n      return { success: true, mirrored: false,\n        warning: \"Receipt recorded on '\" + FIN_ENTRY_TAB + \"', but the '\" + FIN_MIRROR_TAB\n               + \"' tab was not found, so it will not appear in the app until it is copied across.\" };\n    }\n\n    var mirrorHeaders = mirror.getRange(1, 1, 1, mirror.getLastColumn()).getValues()[0].map(String);\n    var dateCol = finCol_(mirrorHeaders, [\"Date\"]);\n    var timeCol = finCol_(mirrorHeaders, [\"Time\"]);\n    // Stop before the computed columns; never write into an ARRAYFORMULA spill.\n    var lastWritable = mirrorHeaders.length;\n    [dateCol, timeCol].forEach(function(c) {\n      if (c >= 0 && c < lastWritable) lastWritable = c;\n    });\n    var mirrorRow = finReceiptRow_(mirrorHeaders, p, stamp).slice(0, lastWritable);\n    mirror.getRange(mirror.getLastRow() + 1, 1, 1, mirrorRow.length).setValues([mirrorRow]);\n\n    return { success: true, mirrored: true };\n  } catch (e) {\n    return { success: false, error: e.message };\n  }\n}\n",
  },
];

const src = process.argv[2];
if (!src) {
  console.error('usage: node apps-script/apply-patch.js path/to/Code.gs');
  process.exit(2);
}

let text = fs.readFileSync(src, 'utf8');
const problems = [];   // stop the run — the file is not what was expected
const already = [];    // fine — this edit is simply already in place
let appliedCount = 0;

for (const edit of EDITS) {
  const n = text.split(edit.find).length - 1;
  if (n === 0) {
    // Distinguish "already done" from "this file is not what I expected".
    // The replacement text is only evidence of the former when the anchor is
    // gone — some replacements legitimately appear elsewhere in the file, so
    // testing for it while the anchor is still present would report a false
    // ALREADY APPLIED and refuse a change that had not been made.
    if (text.includes(edit.replace)) already.push(`  already in place: ${edit.name}`);
    else problems.push(`  NOT FOUND: ${edit.name}`);
    continue;
  }
  if (n > 1) {
    problems.push(`  FOUND ${n} TIMES (expected once): ${edit.name}`);
    continue;
  }
  text = text.replace(edit.find, edit.replace);
  appliedCount++;
  console.log(`  applied: ${edit.name}`);
}

if (already.length) console.log(already.join('\n'));

// An anchor that is neither present nor already applied means this is not the
// file these edits were written against — stop rather than write a half-patched
// backend. An edit that is merely already in place is not a reason to stop:
// a Code.gs part-way through this set is a normal thing to be handed.
if (problems.length) {
  console.error('\nNothing written — this does not look like the expected Code.gs:\n' + problems.join('\n'));
  process.exit(1);
}

if (appliedCount === 0) {
  console.log('\nNothing to do — every change is already in place.');
  process.exit(0);
}

const out = path.join(path.dirname(src), 'Code.patched.gs');
fs.writeFileSync(out, text);
console.log(`\nWrote ${out}`);

console.log('\nBefore deploying: diff it against the original, then');
console.log('Deploy > Manage deployments > pencil > New version > Deploy.');
