// "When a patient does not come on his appointment at the end of the day
//  it should be recorded as Missed appointment and it should not kept
//  open in the records. and neither it should be recorded as cancel by
//  patient it should be missed appointment"
//  "it is showing scheduled and not now show or missed"
//
// Two faults, and they compounded each other.
//
// NOTHING EVER CLOSED A DAY. A booking nobody checked in stayed at
// "Scheduled" for good -- months later the day sheet still read as though
// they were coming.
//
// AND MARKING ONE FILED IT AS A CANCELLATION. The only way was the Cancel
// dialog, where "No Show" was one of four CANCEL REASONS, so it was stored
// as status "Cancelled". The records then could not tell a patient who
// rang to cancel from one who simply did not arrive -- which is the whole
// distinction the clinic needs when deciding who to call back. The report
// that counts no-shows had always shown zero, because nothing in the app
// ever wrote that status.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
const gs = fs.readFileSync(path.join(REPO, 'apps-script/out/Code.gs'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; } else {
    fail++;
    console.log('  FAIL  ' + name + (detail !== undefined ? '\n          ' + String(detail).slice(0, 300) : ''));
  }
};
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want),
  'got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want));

const fnOf = (name) => {
  const a = html.indexOf('function ' + name + '(');
  return html.slice(a, html.indexOf('\n}', a) + 2) + '\n';
};
const ctx = { String, Object, Array, console,
  toISODate: (d) => '2026-11-21' };
vm.createContext(ctx);
vm.runInContext('const APPT_MISSED = "Missed"; const APPT_MISSED_LABEL = "Missed appointment";\n'
  + fnOf('apptIsMissed') + fnOf('apptStatusOf') + fnOf('apptStatusLabel')
  + '\nthis.isMissed = apptIsMissed; this.statusOf = apptStatusOf; this.label = apptStatusLabel;', ctx);

const A = (date, status) => ({ date: date, status: status });
const TODAY = '2026-11-21';

// ── a day that has passed closes itself ────────────────────────────────
eq('a booking left Scheduled on a day gone by IS a missed appointment',
   ctx.statusOf(A('2026-10-04', 'Scheduled'), TODAY), 'Missed');
eq('and reads as one', ctx.label(ctx.statusOf(A('2026-10-04', 'Scheduled'), TODAY)),
   'Missed appointment');
// Today is not over yet. They may still walk in.
eq("today's booking is still expected", ctx.statusOf(A(TODAY, 'Scheduled'), TODAY), 'Scheduled');
eq('and tomorrow\'s certainly is', ctx.statusOf(A('2026-12-01', 'Scheduled'), TODAY), 'Scheduled');
// Anything that was actually touched is left exactly as it is. A patient
// who came and was never checked out is a different problem.
['Checked In', 'In Chair', 'Completed', 'Cancelled'].forEach(st =>
  eq('a past ' + st + ' booking is left alone', ctx.statusOf(A('2026-10-04', st), TODAY), st));
eq('a row with no date is not guessed at', ctx.statusOf(A('', 'Scheduled'), TODAY), 'Scheduled');
eq('nor an empty row', ctx.statusOf(null, TODAY), '');

// ── what counts as missed ──────────────────────────────────────────────
ok('a row the clinic marked missed is missed', ctx.isMissed({ status: 'Missed' }));
// Rows written before this say "No Show". Read, never written again.
ok('and so is one written the old way', ctx.isMissed({ status: 'No Show' }));
ok('a cancellation is not', !ctx.isMissed({ status: 'Cancelled' }));
ok('nor a booking still to come', !ctx.isMissed({ status: 'Scheduled' }));
ok('nor nothing at all', !ctx.isMissed(null));
eq('both old and new read the same on screen',
   [ctx.label('Missed'), ctx.label('No Show')],
   ['Missed appointment', 'Missed appointment']);

// ── not a cancellation ─────────────────────────────────────────────────
ok('"No Show" is gone from the cancel reasons',
   /const CANCEL_REASONS = \["Cancelled by Patient","Cancelled by Doctor","Cancelled by Clinic"\];/.test(html));
ok('and the reasons say why it went', /not turning up is not a\n\/\/ cancellation/.test(html));
ok('Missed is a status with a colour of its own', /Missed:"#9ca3af"/.test(html));

// ── and it stops sitting in the open lists ─────────────────────────────
// Six places list what is still live. A missed appointment is not.
eq('every open list drops it',
   (html.match(/!apptIsMissed\(a\)/g) || []).length, 6);
ok('the day sheet shows what the row IS, not what was last written on it',
   /hhmm\(a\.checkinTime\)\|\|apptStatusLabel\(apptStatusOf\(a\)\)/.test(html));
ok('the calendar chip too', /apptStatusLabel\(ast\)\|\|"Scheduled"/.test(html));
ok('and the appointment popup', /apptStatusLabel\(st\)\|\|"Scheduled"/.test(html));
// Offering "Check In" on a booking from last month would put a patient in
// a chair they left weeks ago.
ok('a missed booking offers no Check In', /return \(st === APPT_MISSED\) \? null : APPT_NEXT_ACTION\[st\];/.test(html));
eq('and every row asks through that guard',
   (html.match(/const action = apptNextAction\(a\);/g) || []).length, 2);

// ── the reports finally have something to count ────────────────────────
ok('the no-show report counts missed appointments',
   /const noShows = d\.appts\.filter\(a => apptIsMissed\(a\)\);/.test(html));
ok('and the recall list names it properly',
   /\?"Cancelled":APPT_MISSED_LABEL\)/.test(html));
ok('the backend\'s recall logic knows the new word, and keeps the old',
   /mstatus !== "Cancelled" && mstatus !== "No Show" && mstatus !== "Missed"/.test(gs));

console.log('  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
