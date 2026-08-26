// Checks the fix for: booking an appointment by phone for a not-yet-
// registered patient (no UHID yet — expected) then, once they're actually
// registered at the clinic, that same visit showing up TWICE — once with no
// UHID (the original phone booking) and once with a UHID (a second
// appointment front desk had to create since there was no way to find the
// first one). findOrphanAppointmentForPhone is what onPatientRegistered
// uses to find that original booking so it can be linked instead of
// duplicated.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const from = html.indexOf('function toISODate(d) {');
const to = html.indexOf('function monthMatrix(');
if (from < 0 || to < 0) { console.error('could not locate findOrphanAppointmentForPhone'); process.exit(1); }

const ctx = {};
vm.createContext(ctx);
vm.runInContext(html.slice(from, to) + ';this.findOrphanAppointmentForPhone = findOrphanAppointmentForPhone;', ctx);
const { findOrphanAppointmentForPhone } = ctx;

const checks = [];
const eq = (name, got, want) => checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });

const TODAY = '2026-08-26';

// --- the exact reported scenario ----------------------------------------
const appts = [
  { id: 'APT-1', uhid: '', mobile: '9876543210', date: TODAY, status: 'Scheduled' }, // the phone booking
  { id: 'APT-2', uhid: 'AL0999', mobile: '9876543210', date: TODAY, status: 'Scheduled' }, // an unrelated already-registered patient, same phone family member? still no UHID means it's a candidate only if uhid blank
];
eq('finds the phone-booked (no UHID) appointment',
  findOrphanAppointmentForPhone(appts, '9876543210', TODAY)?.id, 'APT-1');
eq('does not touch an appointment that already has a UHID',
  findOrphanAppointmentForPhone(appts, '9876543210', TODAY).uhid, '');

// --- no match cases -------------------------------------------------------
eq('no appointments at all -> null', findOrphanAppointmentForPhone([], '9876543210', TODAY), null);
eq('no phone number given -> null', findOrphanAppointmentForPhone(appts, '', TODAY), null);
eq('phone number matches nothing -> null',
  findOrphanAppointmentForPhone(appts, '9999999999', TODAY), null);

// --- an appointment already claimed (has a UHID) is never re-matched -----
const allClaimed = [{ id: 'APT-3', uhid: 'AL0500', mobile: '9876543210', date: TODAY, status: 'Scheduled' }];
eq('every matching appointment already has a UHID -> null (nothing to link)',
  findOrphanAppointmentForPhone(allClaimed, '9876543210', TODAY), null);

// --- a cancelled orphan is not a real candidate ---------------------------
const cancelledOnly = [{ id: 'APT-4', uhid: '', mobile: '9876543210', date: TODAY, status: 'Cancelled' }];
eq('a cancelled appointment is not linked', findOrphanAppointmentForPhone(cancelledOnly, '9876543210', TODAY), null);

// --- phone numbers compared by digits only, ignoring formatting ----------
const formatted = [{ id: 'APT-5', uhid: '', mobile: '+91 98765-43210', date: TODAY, status: 'Scheduled' }];
eq('matches despite spaces/dashes/country code formatting',
  findOrphanAppointmentForPhone(formatted, '9876543210', TODAY)?.id, 'APT-5');

// --- multiple orphans for the same phone -> nearest to today wins --------
const multi = [
  { id: 'FAR-FUTURE', uhid: '', mobile: '9876543210', date: '2026-09-20', status: 'Scheduled' },
  { id: 'TODAY-ONE',  uhid: '', mobile: '9876543210', date: TODAY,        status: 'Scheduled' },
  { id: 'PAST-ONE',   uhid: '', mobile: '9876543210', date: '2026-08-24', status: 'Scheduled' },
];
eq('picks the appointment closest to today over a far-future or past one',
  findOrphanAppointmentForPhone(multi, '9876543210', TODAY)?.id, 'TODAY-ONE');

let pass = 0, fail = 0;
console.log('\n' + '='.repeat(74));
console.log('ORPHAN APPOINTMENT LINKING — PHONE-BOOKED, NOW REGISTERED');
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
