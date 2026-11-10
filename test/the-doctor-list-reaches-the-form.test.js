// "all the treating doctors name are not coming there"
//
// The Treating Doctor dropdown on a work-done form offered one name:
// whichever one is typed into that form's own markup. Every record came out
// under it, whoever was treating.
//
// Two faults, both in how the master list reaches the form.
//
// 1. KB_DOCTORS is filled by useDoctors(), and only a screen that calls it
//    fills it. Clinical Records never did. A dentist who opened Records and
//    went straight into a form had an empty list, because nothing had asked
//    for one.
// 2. sendDoctorsToForm read the list ONCE, before its retry loop, and
//    returned if it was empty. A second after the screen opens the master
//    read is still in flight, so that is the normal state -- and the loop
//    that exists precisely to wait for things never got to run.
//
// Together: the form kept its built-in name and said nothing was wrong.
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; } else {
    fail++;
    console.log('  FAIL  ' + name + (detail !== undefined ? '\n          ' + String(detail).slice(0, 300) : ''));
  }
};
const cut = (a, b) => html.slice(html.indexOf(a), html.indexOf(b, html.indexOf(a)));

// ── the screen asks for the list ────────────────────────────────────────
const records = cut('function ClinicalRecords({ globalPat, setGlobalPat }) {', 'function Prescription(');
ok('Clinical Records asks for the master doctor list', /\n  useDoctors\(\);/.test(records), '');

// ── and the sender waits for it ─────────────────────────────────────────
const senders = (html.match(/const sendDoctorsToForm = async \(uhid\) => \{[\s\S]*?\n  \};/g) || []);
ok('both screens that open a form send the doctors', senders.length === 2, senders.length);
senders.forEach((src, i) => {
  const which = 'sender ' + (i + 1);
  // The whole fix: the list is read inside the loop, so a list that arrives
  // late is still sent.
  ok(which + ': reads the list inside the retry loop',
     /for \(let i = 0; i < 40; i\+\+\) \{[\s\S]*?const list = getDoctors\(\);/.test(src), src.slice(0, 200));
  ok(which + ': does not give up on an empty list before waiting',
     !/const list = getDoctors\(\);\s*\n\s*if \(!list\.length\) return;/.test(src), '');
  ok(which + ': still only posts once there is something to post',
     /if \(list\.length && w\) \{/.test(src), '');
  ok(which + ': and still stops once the form has taken it',
     /typeof w\.applyMasterDoctors === "function"/.test(src) && /if \(ready\) return;/.test(src), '');
});

// ── the forms are built to take it ──────────────────────────────────────
// Each form turns #pDoc into a <select> of the master names. If a form ever
// stopped listening, the dropdown would silently go back to one name.
const forms = [...html.matchAll(/const (\w+_B64) =\n/g)].map(m => m[1]);
const decode = (name) => {
  const i = html.indexOf('const ' + name + ' =');
  const j = html.indexOf('\n\n', i);
  const b64 = [...html.slice(i, j).matchAll(/"([A-Za-z0-9+/=]*)"/g)].map(m => m[1]).join('');
  try { return Buffer.from(b64, 'base64').toString('utf8'); } catch (e) { return ''; }
};
const WORK_DONE = forms.filter(n => !/CRM_B64|CHATBOT_B64/.test(n));
const deaf = WORK_DONE.filter(n => {
  const src = decode(n);
  return src && !/applyMasterDoctors/.test(src);
});
ok('every work-done form listens for the master doctors', deaf.length === 0, deaf.join(', '));
ok('and there are the nineteen of them to check', WORK_DONE.length === 19, WORK_DONE.length);

console.log('  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
