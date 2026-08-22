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
];

// Not applied automatically: it changes nothing today, and a cosmetic edit is
// not worth bundling into a deploy that fixes real data loss.
const ADVISORY = {
  name: 'patientCompleteRegistration — corrupted alias string',
  find: '"In Case Of Emergency Contact Number|Emergency Covar PUBLIC_ACTIONStact"',
  suggest: '"In Case Of Emergency Contact Number|Emergency Contact"',
};

const src = process.argv[2];
if (!src) {
  console.error('usage: node apps-script/apply-patch.js path/to/Code.gs');
  process.exit(2);
}

let text = fs.readFileSync(src, 'utf8');
const problems = [];

for (const edit of EDITS) {
  const n = text.split(edit.find).length - 1;
  if (n !== 1) {
    problems.push(`  ${n === 0 ? 'NOT FOUND' : 'FOUND ' + n + ' TIMES'}: ${edit.name}`);
    continue;
  }
  if (text.includes(edit.replace)) {
    problems.push(`  ALREADY APPLIED: ${edit.name}`);
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

if (text.includes(ADVISORY.find)) {
  console.log(`\nAlso present, not changed — ${ADVISORY.name}:`);
  console.log(`  ${ADVISORY.find}`);
  console.log(`  harmless today (the alias before the | matches first); suggested:`);
  console.log(`  ${ADVISORY.suggest}`);
}

console.log('\nBefore deploying: diff it against the original, then');
console.log('Deploy > Manage deployments > pencil > New version > Deploy.');
