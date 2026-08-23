// Checks the multi-visit treatment logic (ClinicalSuiteMultiVisitSpec.md).
//
// Design principle from the spec: Procedure -> Visit No. -> Stage ->
// Completion, decided by three exception options at the end of every visit
// (continue / add another visit / complete now). This is deliberately NOT a
// clinical engine — nextVisitAfterUsingStages_ is a pure function over the
// stage list, with no dates, chairs, or Sheets access involved.
//
// Runs against the real PROCEDURE_LIBRARY_DEFAULTS shipped in Code.gs, so a
// future edit to the library is what these checks actually exercise.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.resolve(__dirname, '..', 'apps-script', 'out', 'Code.gs'), 'utf8');
const from = src.indexOf('var PROCEDURE_LIBRARY_DEFAULTS');
const to = src.indexOf('function resolveVisitException(');
if (from < 0 || to < 0) { console.error('could not locate the procedure library logic'); process.exit(1); }

const ctx = {};
vm.createContext(ctx);
vm.runInContext(src.slice(from, to) +
  ';this.PROCEDURE_LIBRARY_DEFAULTS = PROCEDURE_LIBRARY_DEFAULTS;' +
  'this.newCaseFromStages_ = newCaseFromStages_;' +
  'this.nextVisitAfterUsingStages_ = nextVisitAfterUsingStages_;', ctx);
const { PROCEDURE_LIBRARY_DEFAULTS, newCaseFromStages_, nextVisitAfterUsingStages_ } = ctx;

function stagesFor(code) {
  return PROCEDURE_LIBRARY_DEFAULTS
    .filter(r => r.procedureCode === code)
    .sort((a, b) => a.visitNo - b.visitNo);
}

const checks = [];
const eq = (name, got, want) => checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });
const ok = (name, cond, detail) => checks.push({ name, ok: !!cond, got: detail, want: 'truthy' });

// --- the library itself ------------------------------------------------
ok('library has all 115 procedures from the V2 master list',
  new Set(PROCEDURE_LIBRARY_DEFAULTS.map(r => r.procedureCode)).size === 115,
  new Set(PROCEDURE_LIBRARY_DEFAULTS.map(r => r.procedureCode)).size);
ok('every procedure has exactly one completing stage',
  Object.entries(
    PROCEDURE_LIBRARY_DEFAULTS.reduce((m, r) => {
      m[r.procedureCode] = (m[r.procedureCode] || 0) + (r.completesTreatment ? 1 : 0);
      return m;
    }, {})
  ).every(([, n]) => n === 1),
  'a procedure with != 1 completing stage would break case-completion');

// --- Single Crown: 3 visits, matches the spec's own worked example shape ---
const crown = stagesFor('SINGLE_CROWN');
eq('Single Crown has 3 stages', crown.length, 3);

const newCase = newCaseFromStages_('SINGLE_CROWN', crown);
eq('new case -> visit 1 of 3', [newCase.visitNo, newCase.totalVisits], [1, 3]);
eq('new case -> first stage', newCase.stageCode, 'PREPARATION_SCAN_IMPRESSION');
eq('new case -> not final', newCase.isFinalVisit, false);

// Continue through all three stages.
let v1 = { procedureCode: 'SINGLE_CROWN', procedureName: 'Single Crown',
  visitNo: 1, totalVisits: 3, stageCode: 'PREPARATION_SCAN_IMPRESSION', isFinalVisit: false };
let r1 = nextVisitAfterUsingStages_(v1, 'continue', crown);
eq('visit 1 continue -> not completed', r1.caseCompleted, false);
eq('visit 1 continue -> visit 2, Try-In', [r1.nextVisit.visitNo, r1.nextVisit.stageCode], [2, 'TRY_IN']);
eq('visit 1 continue -> totalVisits unchanged', r1.nextVisit.totalVisits, 3);

let v2 = { procedureCode: 'SINGLE_CROWN', procedureName: 'Single Crown',
  visitNo: 2, totalVisits: 3, stageCode: 'TRY_IN', isFinalVisit: false };
let r2 = nextVisitAfterUsingStages_(v2, 'continue', crown);
eq('visit 2 continue -> visit 3, Final Fitting', [r2.nextVisit.visitNo, r2.nextVisit.stageCode], [3, 'FINAL_FITTING']);
eq('visit 3 (Final Fitting) is marked final by the library', r2.nextVisit.isFinalVisit, true);

let v3 = { procedureCode: 'SINGLE_CROWN', procedureName: 'Single Crown',
  visitNo: 3, totalVisits: 3, stageCode: 'FINAL_FITTING', isFinalVisit: true };
let r3 = nextVisitAfterUsingStages_(v3, 'continue', crown);
eq('finishing the final stage with continue completes the case', r3.caseCompleted, true);
eq('completed case has no next visit', r3.nextVisit, null);

// --- Option B: add another visit --------------------------------------
let r2b = nextVisitAfterUsingStages_(v2, 'add_visit', crown);
eq('add_visit -> not completed', r2b.caseCompleted, false);
eq('add_visit -> repeats current stage', r2b.nextVisit.stageCode, 'TRY_IN');
eq('add_visit -> stage name is annotated', r2b.nextVisit.stageName.indexOf('Adjustment') >= 0, true);
eq('add_visit -> visitNo advances by 1', r2b.nextVisit.visitNo, 3);
eq('add_visit -> totalVisits grows by 1 (was 3, becomes 4)', r2b.nextVisit.totalVisits, 4);
eq('add_visit -> the inserted visit is never final on its own', r2b.nextVisit.isFinalVisit, false);

// Rule from the spec: add_visit after what the library calls the FINAL stage
// still extends the treatment rather than completing it.
let r3b = nextVisitAfterUsingStages_(v3, 'add_visit', crown);
eq('add_visit after the final stage extends rather than completes', r3b.caseCompleted, false);
eq('add_visit after final -> repeats Final Fitting', r3b.nextVisit.stageCode, 'FINAL_FITTING');

// --- Option C: complete now, at any stage -------------------------------
let r1c = nextVisitAfterUsingStages_(v1, 'complete', crown);
eq('complete at visit 1 of 3 -> case completed immediately', r1c.caseCompleted, true);
eq('complete -> no next visit generated', r1c.nextVisit, null);

// --- RCT Molar: matches the spec's own worked example (4 visits) --------
const rctMolar = stagesFor('RCT_MOLAR');
eq('RCT Molar has 4 stages', rctMolar.length, 4);
const rctCase = newCaseFromStages_('RCT_MOLAR', rctMolar);
eq('RCT Molar new case -> visit 1 of 4', [rctCase.visitNo, rctCase.totalVisits], [1, 4]);

// --- Complete Denture: matches the spec's own worked example (5 visits) --
const denture = stagesFor('COMPLETE_DENTURE');
eq('Complete Denture has 5 stages', denture.length, 5);
eq('Complete Denture final stage is Delivery',
  denture[denture.length - 1].stageCode, 'DELIVERY');

// --- a single-visit procedure completes on its one and only visit -------
const scaling = stagesFor('SCALING');
eq('Scaling is a single-visit procedure', scaling.length, 1);
const scalingCase = newCaseFromStages_('SCALING', scaling);
eq('Scaling -> visit 1 of 1, already final', [scalingCase.visitNo, scalingCase.totalVisits, scalingCase.isFinalVisit], [1, 1, true]);

// --- unknown procedure code ---------------------------------------------
eq('unknown procedureCode -> no new case', newCaseFromStages_('NOT_A_REAL_CODE', []), null);

let pass = 0, fail = 0;
console.log('\n' + '='.repeat(74));
console.log('PROCEDURE LIBRARY — MULTI-VISIT TREATMENT LOGIC');
console.log('='.repeat(74));
for (const c of checks) {
  c.ok ? pass++ : fail++;
  console.log((c.ok ? '  PASS  ' : '  FAIL  ') + c.name +
    (c.ok ? '' : `\n          expected ${JSON.stringify(c.want)}, got ${JSON.stringify(c.got)}`));
}
console.log('='.repeat(74));
console.log(`  ${pass} passed, ${fail} failed`);
console.log('='.repeat(74) + '\n');
process.exit(fail ? 1 : 0);
