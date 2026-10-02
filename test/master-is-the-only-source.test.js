// The app carried its own copy of three lists Master already owns, and fell
// back to it whenever the Master tab was empty. All three were empty, so the
// fallback WAS the app's behaviour — and editing Payment Modes in Master
// changed some screens and not others, because only some read the sheet.
//
// Master now holds them (seeded in both books on 2 Oct 2026) and the copies
// are gone. The property to hold is simple and easy to lose later: no list
// the clinic edits may exist in the code as well.

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
const GS = fs.readFileSync(path.join(REPO, 'apps-script/out/Code.gs'), 'utf8');

const checks = [];
const eq = (name, got, want) =>
  checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });
const ok = (name, cond, detail) => checks.push({ name, ok: !!cond, got: detail, want: 'truthy' });

// --- the copies are gone --------------------------------------------------
['PAYMENT_MODES', 'PAYMENT_MODES_FIN', 'DEFAULT_CHAIRS'].forEach(name => {
  eq('no built-in ' + name + ' remains', new RegExp('\\b' + name + '\\b').test(html), false);
});
// The backend had its own, which is why an empty Chairs tab still produced
// four chairs and nobody ever noticed the tab was empty.
eq('the backend no longer invents four chairs',
  /items = \["Chair 1"/.test(GS), false);
ok('and says why it does not', /No built-in fallback/.test(GS));

// --- payment modes come from Master, on BOTH screens ----------------------
ok('there is one shared hook for the list',
  /const usePaymentModes = \(\) => useMasterList\("getPaymentModesList", "modes"\)/.test(html));
// Two call sites: the Daily Register and the finance receipt. The definition
// is an arrow assignment, so it does not call itself.
const uses = (html.match(/usePaymentModes\(\)/g) || []).length;
eq('both screens read it, and only those two', uses, 2);
ok('the register dropdown is built from it',
  /nPayModes\.map\(m=>React\.createElement\("option"/.test(html));
ok('and the receipt radios too', /payModes\.map\(m =>/.test(html));

// --- the list is fetched once, not once per screen ------------------------
// Two Apps Script round trips for the same six words is two seconds of
// waiting for nothing, and the two screens could show different answers
// mid-flight.
ok('the fetch is cached across components', /const KB_LIST_CACHE = \{\}/.test(html));
ok('a cached list is used without refetching',
  /if \(KB_LIST_CACHE\[action\]\) \{ setItems\(KB_LIST_CACHE\[action\]\); return; \}/.test(html));
// An answer arriving after the component has gone must not set state on it.
ok('a late answer does not land on an unmounted screen',
  /let alive = true;[\s\S]*if \(alive\) setItems\(list\);[\s\S]*alive = false;/.test(html));

// --- empty must stay empty ------------------------------------------------
// The whole fault was a list that looked right while Master said otherwise.
ok('an empty answer yields an empty list, not a substitute',
  /const list = \(res && res\.success && res\[key\]\) \|\| \[\];/.test(html));

// --- doctors: one list, and it is Master's --------------------------------
// There used to be four answers to "who are the doctors": two names in this
// file, a per-browser localStorage copy, a "Doctors" tab the settings screen
// wrote to, and the "Doctor Details" tab Master edits. Which one a screen
// showed depended on the screen — and the two in the code won whenever the
// rest were empty, which they all were.
eq('no built-in doctors remain', /DEFAULT_DOCTORS/.test(html), false);
eq('the per-browser copy is gone', /saveDoctorsLS/.test(html), false);
eq('and the second backend list is no longer read',
  /api\("getDoctorsList"\)|api\("saveDoctorsList"/.test(html), false);
ok('doctors come from the tab Master edits',
  /useMasterList\("getDoctorDetailsList", "doctors"\)/.test(html));
ok('every screen offering a doctor reads that one list',
  (html.match(/useDoctors\(\)/g) || []).length >= 5,
  (html.match(/useDoctors\(\)/g) || []).length);

// The settings screen writes the SAME list, and its rows carry phone, email
// and role — a name-only edit there must not throw those away.
ok('the settings screen saves to Master\'s list',
  /api\("saveDoctorDetailsList"/.test(html));
ok('and carries existing rows over whole',
  /byName\[n\] \|\| \{ name: n, phone: "", email: "", role: "Doctor" \}/.test(html));
// A failed save must not leave the screen claiming the doctor was added.
ok('a failed save is reported, not swallowed',
  /if \(!res \|\| !res\.success\) \{\s*setMsg\("Could not save the doctors list/.test(html));
// Other screens read the cache, so a save has to update it or they go stale.
ok('a save updates the shared list the other screens read',
  /KB_LIST_CACHE\["getDoctorDetailsList"\] = merged;/.test(html));

// --- chairs start empty and wait for the sheet ----------------------------
eq('no screen starts with invented chairs',
  /useState\(DEFAULT_CHAIRS/.test(html), false);
ok('chairs are still loaded from the backend',
  (html.match(/api\("getChairsList"\)/g) || []).length >= 2);

let pass = 0, fail = 0;
console.log('\n' + '='.repeat(78));
console.log('MASTER IS THE ONLY SOURCE — NO SECOND COPY IN THE CODE');
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
