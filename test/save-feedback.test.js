// "Data is not getting saved immediately, even the payment" — it was saved.
// Every api() call is its own HTTPS round trip to Apps Script, each taking
// about as long as the save did, and the screen only redrew once the reloads
// behind the save came back. At the front desk that reads as a lost entry,
// and the natural response is to type it again.
//
// Two separate causes, so two separate checks on the real source.

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const checks = [];
const eq = (name, got, want) =>
  checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });
const ok = (name, cond, detail) => checks.push({ name, ok: !!cond, got: detail, want: 'truthy' });

const slice = (from, to) => {
  const a = html.indexOf(from);
  if (a < 0) throw new Error('could not find ' + from);
  const b = html.indexOf(to, a);
  return html.slice(a, b < 0 ? a + 2000 : b);
};

// --- the Daily Register shows the row it just saved -----------------------
const reg = slice('const res = await api("saveToDailyRegister"', 'React.useEffect');
ok('the register adds the saved row to the table itself',
  /setEntries\(prev =>/.test(reg));
ok('and still reloads afterwards to reconcile with the server',
  /setEntries\(prev =>[\s\S]*loadEntries\(\)/.test(reg));

// The optimistic row is useless if its keys are not the ones the table reads.
// Compare against the keys the save actually sends, which are the backend's.
const sent = (slice('const res = await api("saveToDailyRegister"', 'if (res.success && nAddToDaysheet')
  .match(/^\s*(\w+):/gm) || []).map(s => s.trim().replace(':', ''));
const shown = (reg.slice(reg.indexOf('setEntries(prev =>'))
  .match(/^\s*(\w+):/gm) || []).map(s => s.trim().replace(':', ''));
const missing = sent.filter(k => shown.indexOf(k) < 0);
eq('the row shown carries every field the save sent', missing, []);

// --- the payment does not sit on a timer before refreshing ----------------
const rec = slice('const res = await api("saveReceipt"', 'const RadioGroup');
ok('a saved payment refreshes straight away',
  /if \(onSaved\) onSaved\(\);/.test(rec) &&
  !/setTimeout\([^)]*onSaved/.test(rec), rec.match(/setTimeout[\s\S]{0,60}/));
ok('the confirmation tick is still shown', /setMsg\("✅ Saved!"\)/.test(rec));
ok('and is still cleared afterwards', /setTimeout\(\(\) => setMsg\(""\), 1200\)/.test(rec));

let pass = 0, fail = 0;
console.log('\n' + '='.repeat(78));
console.log('A SAVE SHOWS ON SCREEN WITHOUT WAITING FOR THE RELOAD');
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
