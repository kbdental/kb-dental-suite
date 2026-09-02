// Checks the appointment WhatsApp reminder: plain text only (no PDF/receipt-
// style document — that was tried and then deliberately removed in favor of
// a simple text message the clinic can review and tweak).
//
//  - the "Notify Patient — WhatsApp" checkbox (previously collected and
//    never used for anything) opens a WhatsApp chat addressed to the
//    patient's own number, pre-filled with a plain-text reminder
//  - that message matches the exact wording the clinic already sends
//    manually ("Gentle reminder for your appointment on 1 September at
//    10:00AM with Dr. Manika Mittel at K B Dental Clinic. Please arrive 5
//    minutes early. Any query call 9319990912"), just generated from the
//    app instead of typed by hand
//
// Extracted from index.html by line range and run under Node's vm — same
// approach fee-receipt-redesign.test.js uses for its pure string-building
// functions.

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

const src = extract('const APPT_MONTHS_LONG', '// ── Add Receipt');

const ctx = { window: {}, console };
vm.createContext(ctx);
vm.runInContext(src, ctx);
const { apptDateLong, apptTime12h, appointmentWhatsAppText, openAppointmentWhatsAppChat } = ctx;

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
  'Gentle reminder for your appointment on 1 September at 10:00AM with Dr. Manika Mittel at K B Dental Clinic. Please arrive 5 minutes early. Any query call 9319990912');

// A different doctor/date/time still fits the same template correctly.
eq('template holds for a different doctor/date/time',
  appointmentWhatsAppText({ doctor: 'Dr. Viveyk Mittel', date: '2026-12-25', time: '16:45' }),
  'Gentle reminder for your appointment on 25 December at 4:45PM with Dr. Viveyk Mittel at K B Dental Clinic. Please arrive 5 minutes early. Any query call 9319990912');

// --- opening the chat: plain text, no file, addressed to the patient -----
let opened = null;
ctx.window.open = (url) => { opened = url; };
const sent = openAppointmentWhatsAppChat(SAMPLE);
eq('reports success when a mobile number is present', sent, true);
ok('opens wa.me addressed to the patient\'s own number (with country code)', opened && opened.startsWith('https://wa.me/919319990912?text='));
const urlText = decodeURIComponent(opened.split('?text=')[1]);
eq('the URL carries exactly the plain-text reminder, nothing else', urlText, appointmentWhatsAppText(SAMPLE));

opened = null;
const noPhone = openAppointmentWhatsAppChat({ ...SAMPLE, mobile: '' });
eq('does nothing and reports failure when there is no mobile number', noPhone, false);
eq('does not attempt to open anything without a number', opened, null);

let pass = 0, fail = 0;
console.log('\n' + '='.repeat(78));
console.log('APPOINTMENTS — WHATSAPP REMINDER (PLAIN TEXT ONLY)');
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
