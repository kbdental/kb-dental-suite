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
