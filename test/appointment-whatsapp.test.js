// Checks the appointment-side of the same PDF/WhatsApp/Print system already
// shipped for fee receipts:
//  - the "Notify Patient — WhatsApp" checkbox (previously collected and
//    never used for anything) now produces a real WhatsApp message
//  - that message matches the exact wording the clinic already sends
//    manually ("Gentle reminder for your appointment on 1 September at
//    10:00AM with Dr. Manika Mittel at K B Dental Clinic. Any query call
//    9319990912"), just generated from the app instead of typed by hand
//  - the appointment confirmation slip (for the PDF/Print buttons) carries
//    the actual appointment details
//
// Extracted from index.html by line range and run under Node's vm, the
// same approach fee-receipt-redesign.test.js uses — these are pure
// string-building functions; the html2canvas/jsPDF wiring around them is
// exercised by hand (this sandbox's network policy blocks the CDN scripts
// a real browser load of index.html would need).

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.resolve(__dirname, '..');
const lines = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8').split('\n');

function extract(startMarker, endMarker) {
  const start = lines.findIndex(l => l.startsWith(startMarker));
  if (start < 0) throw new Error('could not find ' + startMarker);
  const end = lines.findIndex((l, i) => i > start && l.startsWith(endMarker));
  if (end < 0) throw new Error('could not find ' + endMarker + ' after ' + startMarker);
  return lines.slice(start, end).join('\n');
}

const src = [
  extract('function fmtDMY', 'function getDoctors'),
  extract('function buildAppointmentHTML', 'function generateAppointmentPrint'),
  extract('const APPT_MONTHS_LONG', 'async function shareAppointmentWhatsApp'),
].join('\n\n');

const ctx = { window: { LOGO_B64: 'data:image/png;base64,STUB' }, console };
vm.createContext(ctx);
vm.runInContext(src, ctx);
const { apptDateLong, apptTime12h, appointmentWhatsAppText, buildAppointmentHTML } = ctx;

const checks = [];
const eq = (name, got, want) => checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });
const ok = (name, cond, detail) => checks.push({ name, ok: !!cond, got: detail, want: 'truthy' });

// --- date/time formatting matching "1 September" / "10:00AM" -------------
eq('date formats as "day monthname", no year', apptDateLong('2026-09-01'), '1 September');
eq('single-digit day has no leading zero', apptDateLong('2026-09-05'), '5 September');
eq('24h morning time formats as HH:MMAM', apptTime12h('10:00'), '10:00AM');
eq('24h afternoon time formats as H:MMPM', apptTime12h('14:30'), '2:30PM');
eq('midnight formats as 12:00AM', apptTime12h('00:00'), '12:00AM');
eq('noon formats as 12:00PM', apptTime12h('12:00'), '12:00PM');

// --- the exact wording the clinic already sends ---------------------------
const SAMPLE = { patientName: 'Test Patient', uhid: 'AL0777', date: '2026-09-01', time: '10:00',
  doctor: 'Dr. Manika Mittel', chair: 'Chair 1', type: 'Consultation', mobile: '9319990912' };
eq('WhatsApp text matches the clinic\'s existing wording exactly',
  appointmentWhatsAppText(SAMPLE),
  'Gentle reminder for your appointment on 1 September at 10:00AM with Dr. Manika Mittel at K B Dental Clinic. Any query call 9319990912');

// A different doctor/date/time still fits the same template correctly.
eq('template holds for a different doctor/date/time',
  appointmentWhatsAppText({ doctor: 'Dr. Viveyk Mittel', date: '2026-12-25', time: '16:45' }),
  'Gentle reminder for your appointment on 25 December at 4:45PM with Dr. Viveyk Mittel at K B Dental Clinic. Any query call 9319990912');

// --- the PDF/Print confirmation slip carries the real details -------------
const html = buildAppointmentHTML(SAMPLE);
ok('slip has CARES header', html.includes('C. A. R. E. S.'));
ok('slip is titled Appointment Confirmation', html.includes('Appointment Confirmation'));
ok('slip shows the patient name', html.includes('Test Patient'));
ok('slip shows the UHID', html.includes('AL0777'));
ok('slip shows the doctor', html.includes('Dr. Manika Mittel'));
ok('slip shows the chair', html.includes('Chair 1'));
ok('slip shows the reason', html.includes('Consultation'));

// Notes are optional — only rendered when present, not as a literal blank box.
const htmlNoNotes = buildAppointmentHTML(SAMPLE);
ok('no Notes field when none given', !htmlNoNotes.includes('>Notes<'));
const htmlWithNotes = buildAppointmentHTML({ ...SAMPLE, notes: 'Bring previous X-ray' });
ok('Notes field appears and shows the text when given', htmlWithNotes.includes('>Notes<') && htmlWithNotes.includes('Bring previous X-ray'));

let pass = 0, fail = 0;
console.log('\n' + '='.repeat(78));
console.log('APPOINTMENTS — WHATSAPP CONFIRMATION (SAME SYSTEM AS RECEIPTS)');
console.log('='.repeat(78));
for (const c of checks) {
  c.ok ? pass++ : fail++;
  console.log((c.ok ? '  PASS  ' : '  FAIL  ') + c.name +
    (c.ok ? '' : `\n          expected ${JSON.stringify(c.want)}, got ${JSON.stringify(c.got)}`));
}
console.log('='.repeat(78));
console.log(`  ${pass} passed, ${fail} failed`);
console.log('='.repeat(78) + '\n');
process.exit(fail ? 1 : 0);
