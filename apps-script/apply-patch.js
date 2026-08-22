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
    find: `      "Report Findings": p.reportFindings || "",
      "Follow-up Action": p.followupAction || ""`,
    replace: `      "Report Findings": p.reportFindings || "",
      "Follow-up Action": p.followupAction || "",
      "Remarks": p.remarks || ""`,
  },
  {
    name: 'saveRadiology — store the Remarks it discards',
    find: `      "Findings Summary": p.findingsSummary || "",
      "Follow-up Recommendation": p.followupRecommendation || ""`,
    replace: `      "Findings Summary": p.findingsSummary || "",
      "Follow-up Recommendation": p.followupRecommendation || "",
      "Remarks": p.remarks || ""`,
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
];

const src = process.argv[2];
if (!src) {
  console.error('usage: node apps-script/apply-patch.js path/to/Code.gs');
  process.exit(2);
}

let text = fs.readFileSync(src, 'utf8');
const problems = [];

for (const edit of EDITS) {
  const n = text.split(edit.find).length - 1;
  if (n === 0) {
    // Distinguish "already done" from "this file is not what I expected".
    // The replacement text is only evidence of the former when the anchor is
    // gone — some replacements legitimately appear elsewhere in the file, so
    // testing for it while the anchor is still present would report a false
    // ALREADY APPLIED and refuse a change that had not been made.
    problems.push(`  ${text.includes(edit.replace) ? 'ALREADY APPLIED' : 'NOT FOUND'}: ${edit.name}`);
    continue;
  }
  if (n > 1) {
    problems.push(`  FOUND ${n} TIMES (expected once): ${edit.name}`);
    continue;
  }
  text = text.replace(edit.find, edit.replace);
  console.log(`  applied: ${edit.name}`);
}

if (problems.length) {
  console.error('\nNothing written. Fix these first:\n' + problems.join('\n'));
  console.error('\nIf an edit is already applied, that is fine — it means this ran before.');
  process.exit(1);
}

const out = path.join(path.dirname(src), 'Code.patched.gs');
fs.writeFileSync(out, text);
console.log(`\nWrote ${out}`);

console.log('\nBefore deploying: diff it against the original, then');
console.log('Deploy > Manage deployments > pencil > New version > Deploy.');
