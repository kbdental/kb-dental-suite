// Checks the V2 multi-visit treatment logic (ClinicalSuiteTreatmentCaseSpecV2.md).
//
// Core V2 principle: STAGE COMPLETION is the logic, the visit number is only
// a counter. A Case holds an ordered "stages" array (copied from the
// procedure library at creation), and everything else — current stage, next
// stage, whether the case is complete — is derived from that array, never
// stored separately. One appointment can complete several stages at once.
//
// deriveCaseView_ and applyStageOutcome_ are pure functions (no Sheets
// access), so they're exercised directly here, against the real
// PROCEDURE_LIBRARY_DEFAULTS shipped in Code.gs.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.resolve(__dirname, '..', 'apps-script', 'out', 'Code.gs'), 'utf8');
const from = src.indexOf('var STAGE_CODES');
const to = src.indexOf('// APPOINTMENT REASONS (manageable list, like Doctors)');
if (from < 0 || to < 0) { console.error('could not locate the treatment case logic'); process.exit(1); }

const ctx = {};
vm.createContext(ctx);
vm.runInContext(src.slice(from, to) +
  ';this.PROCEDURE_LIBRARY_DEFAULTS = PROCEDURE_LIBRARY_DEFAULTS;' +
  'this.PROCEDURE_FAMILIES = PROCEDURE_FAMILIES;' +
  'this.buildInitialStages_ = buildInitialStages_;' +
  'this.deriveCaseView_ = deriveCaseView_;' +
  'this.applyStageOutcome_ = applyStageOutcome_;' +
  'this.caseIdFor_ = caseIdFor_;', ctx);
const { PROCEDURE_LIBRARY_DEFAULTS, PROCEDURE_FAMILIES, buildInitialStages_, deriveCaseView_, applyStageOutcome_, caseIdFor_ } = ctx;

function stagesFor(code) {
  return PROCEDURE_LIBRARY_DEFAULTS
    .filter(r => r.procedureCode === code)
    .sort((a, b) => a.sequenceNo - b.sequenceNo);
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
eq('all ten families are used', PROCEDURE_FAMILIES.length, 10);
ok('every procedure belongs to one of the ten families',
  PROCEDURE_LIBRARY_DEFAULTS.every(r => PROCEDURE_FAMILIES.includes(r.familyCode)),
  [...new Set(PROCEDURE_LIBRARY_DEFAULTS.map(r => r.familyCode))]);

// --- Single Crown: matches the spec's own worked example ---------------
const crownStages = stagesFor('SINGLE_CROWN');
eq('Single Crown has 3 stages', crownStages.length, 3);

const initial = buildInitialStages_(crownStages);
ok('a fresh case starts every stage pending', initial.every(s => s.status === 'pending'));
let view = deriveCaseView_(initial);
eq('fresh case -> current is stage 1 (Preparation)', view.currentStageName, 'Preparation + Scan/Impression');
eq('fresh case -> next is stage 2 (Try-In)', view.nextStageName, 'Try-In');
eq('fresh case -> not complete', view.isComplete, false);

// --- starting a case partway through (a legacy patient) -----------------
const lateStart = buildInitialStages_(crownStages, 2); // opened straight at Try-In
eq('starting at stage 2 -> stage 1 pre-marked completed', lateStart[0].status, 'completed');
eq('starting at stage 2 -> stage 1 has no completion date (assumed, not tracked)', lateStart[0].completedDate, '');
eq('starting at stage 2 -> current is Try-In, not Preparation', deriveCaseView_(lateStart).currentStageName, 'Try-In');
const noLateStart = buildInitialStages_(crownStages, 0);
eq('startAtSequenceNo 0 behaves like no override at all', noLateStart.every(s => s.status === 'pending'), true);

// Approve stage 1 -> advances to stage 2.
let stages = applyStageOutcome_(initial, [1], 'approved', 'APT-1');
view = deriveCaseView_(stages);
eq('after approving stage 1 -> current is Try-In', view.currentStageName, 'Try-In');
eq('after approving stage 1 -> next is Final Fitting', view.nextStageName, 'Final Fitting');
eq('stage 1 recorded as completed with its appointment id',
  stages.find(s => s.sequenceNo === 1).completedInAppointment, 'APT-1');

// Approve stage 2 -> advances to stage 3 (the final one).
stages = applyStageOutcome_(stages, [2], 'approved', 'APT-2');
view = deriveCaseView_(stages);
eq('after approving stage 2 -> current is Final Fitting', view.currentStageName, 'Final Fitting');
eq('not complete until the final stage is actually completed', view.isComplete, false);

// Approve stage 3, the completesTreatment one -> case is done.
stages = applyStageOutcome_(stages, [3], 'approved', 'APT-3');
view = deriveCaseView_(stages);
eq('completing the final stage closes the case', view.isComplete, true);
eq('no current stage left once complete', view.currentStageCode, '');

// --- Adjustment required — inserts a repeat stage, doesn't renumber -----
let adjStages = applyStageOutcome_(buildInitialStages_(crownStages), [1], 'approved', 'APT-1');
adjStages = applyStageOutcome_(adjStages, [2], 'adjustment_required', 'APT-2');
view = deriveCaseView_(adjStages);
eq('adjustment -> current is the inserted repeat stage', view.currentStageName, 'Try-In / adjustment');
ok('adjustment -> original stage 3 (Final Fitting) untouched, still sequenceNo 3',
  adjStages.some(s => s.sequenceNo === 3 && s.stageName === 'Final Fitting' && s.status === 'pending'));
// Resolve the inserted stage -> falls through to the real Final Fitting.
const insertedSeq = adjStages.find(s => s.stageName === 'Try-In / adjustment').sequenceNo;
const afterAdj = applyStageOutcome_(adjStages, [insertedSeq], 'approved', 'APT-3');
view = deriveCaseView_(afterAdj);
eq('after resolving the adjustment -> current is Final Fitting again', view.currentStageName, 'Final Fitting');

// --- Proceed to completion — ends the case early, whatever remains ------
let earlyStages = applyStageOutcome_(buildInitialStages_(crownStages), [1], 'proceed_to_completion', 'APT-1');
view = deriveCaseView_(earlyStages);
eq('proceed to completion at stage 1 of 3 -> case complete immediately', view.isComplete, true);
ok('proceed to completion -> stages 2 and 3 marked skipped, not completed',
  earlyStages.filter(s => s.sequenceNo !== 1).every(s => s.status === 'skipped'));

// --- Multiple stages completed in ONE appointment — the reason V2 exists --
const rctMolarStages = stagesFor('RCT_MOLAR');
eq('RCT Molar has 4 stages', rctMolarStages.length, 4);
const rctInitial = buildInitialStages_(rctMolarStages);
// Prep + Scan + Temporary all done in one sitting: stages 1, 2, 3 close together.
const rctAfterOneVisit = applyStageOutcome_(rctInitial, [1, 2, 3], 'approved', 'APT-X');
eq('three stages completed in one call all carry the same appointment id',
  rctAfterOneVisit.filter(s => s.completedInAppointment === 'APT-X').length, 3);
view = deriveCaseView_(rctAfterOneVisit);
eq('case advances straight to stage 4 after three stages close at once', view.currentStageName, 'Restoration');
eq('not complete yet — one stage still pending', view.isComplete, false);

// --- applyStageOutcome_ must not mutate its input (it's meant to be pure) -
const pristine = buildInitialStages_(crownStages);
const pristineSnapshot = JSON.stringify(pristine);
applyStageOutcome_(pristine, [1], 'approved', 'APT-MUT');
eq('applyStageOutcome_ does not mutate the stages array it was given', JSON.stringify(pristine), pristineSnapshot);

// --- caseId format -------------------------------------------------------
eq('caseId: first case for this patient+procedure', caseIdFor_('AA0127', 'SINGLE_CROWN', 0), 'AA0127-SINGLE_CROWN-01');
eq('caseId: second case for the same patient+procedure', caseIdFor_('AA0127', 'SINGLE_CROWN', 1), 'AA0127-SINGLE_CROWN-02');

// --- Complete Denture: matches the spec's own worked example (5 stages) --
const dentureStages = stagesFor('COMPLETE_DENTURE');
eq('Complete Denture has 5 stages', dentureStages.length, 5);
eq('Complete Denture final stage is Delivery', dentureStages[dentureStages.length - 1].stageName, 'Delivery');

// --- a single-stage procedure completes on its one and only stage -------
const scalingStages = stagesFor('SCALING');
eq('Scaling is a single-stage procedure', scalingStages.length, 1);
const scalingInitial = buildInitialStages_(scalingStages);
const scalingAfter = applyStageOutcome_(scalingInitial, [1], 'approved', 'APT-S');
eq('Scaling -> completing its only stage closes the case', deriveCaseView_(scalingAfter).isComplete, true);

let pass = 0, fail = 0;
console.log('\n' + '='.repeat(76));
console.log('TREATMENT CASE — V2 STAGE-COMPLETION LOGIC');
console.log('='.repeat(76));
for (const c of checks) {
  c.ok ? pass++ : fail++;
  console.log((c.ok ? '  PASS  ' : '  FAIL  ') + c.name +
    (c.ok ? '' : `\n          expected ${JSON.stringify(c.want)}, got ${JSON.stringify(c.got)}`));
}
console.log('='.repeat(76));
console.log(`  ${pass} passed, ${fail} failed`);
console.log('='.repeat(76) + '\n');
process.exit(fail ? 1 : 0);
