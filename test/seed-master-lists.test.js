// The app carries a built-in copy of Doctors, Payment Modes and Chairs and
// falls back to it whenever the Master tab is empty — which all three are.
// That is why editing Payment Modes in Master changes some screens and not
// others. Master cannot become the single source while the tabs are empty:
// removing the built-in lists then would leave the app with no doctors, no
// payment modes and no chairs.
//
// So this writes the values the app is ALREADY using into Master. The thing
// that must be true is that it writes exactly those values — a "tidied up"
// list here would be a silent change to what the clinic sees — and that it
// never replaces a list the clinic has already filled in.

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const GS = fs.readFileSync(path.join(REPO, 'apps-script/maintenance/seed-master-lists.gs'), 'utf8');
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
const CODE = fs.readFileSync(path.join(REPO, 'apps-script/out/Code.gs'), 'utf8');

const checks = [];
const eq = (name, got, want) =>
  checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });
const ok = (name, cond, detail) => checks.push({ name, ok: !!cond, got: detail, want: 'truthy' });

// --- run the real script against a fake book ------------------------------
class Sheet {
  constructor(n, rows) { this.name = n; this.rows = rows || []; this.cleared = 0; }
  getLastRow() { return this.rows.length; }
  clearContents() { this.cleared++; this.rows = []; }
  appendRow(r) { this.rows.push(r.slice()); }
}
class Book {
  constructor(tabs) { this.tabs = {}; this.made = []; Object.keys(tabs).forEach(k => this.tabs[k] = new Sheet(k, tabs[k])); }
  getName() { return 'Test Book'; }
  getSheetByName(n) { return this.tabs[n] || null; }
  insertSheet(n) { this.made.push(n); return (this.tabs[n] = new Sheet(n, [])); }
}
function boot(book, confirm) {
  const logged = [];
  const fmt = (f, ...a) => { let i = 0; return String(f).replace(/%s/g, () => (i < a.length ? String(a[i++]) : '%s')); };
  const api = new Function('SpreadsheetApp', 'Logger',
    GS.replace('var CONFIRM_SEED = "";', 'var CONFIRM_SEED = "' + (confirm || '') + '";') +
    '\nreturn { reportMasterSeed, seedMasterLists, SEED };'
  )({ getActiveSpreadsheet: () => book }, { log: (...a) => logged.push(fmt(...a)) });
  return { api, logged };
}

// --- the values must be the app's own, not a tidied-up version ------------
{
  const { api } = boot(new Book({}));
  const vals = (tab) => api.SEED[tab].rows.map(r => r[0]);
  const fromCode = (name) => {
    const m = new RegExp('const ' + name + ' = \\[([^\\]]+)\\]').exec(html);
    return (m[1].match(/"([^"]*)"/g) || []).map(s => s.slice(1, -1));
  };
  eq('the doctors are the app\'s own', vals('Doctor Details'), fromCode('DEFAULT_DOCTORS'));
  // Payment modes are the exception: the app had two lists that disagreed —
  // the register's and the receipt's — so there was no single "app's own" to
  // copy. This is the list the clinic decided on, and both screens will read
  // it. Pinned here because getting it wrong changes what is recorded against
  // real money.
  eq('the payment modes are the one agreed list', vals('Payment Modes'),
    ['Cash', 'UPI / GPay', 'NEFT/RTGS', 'Cheque', 'Card', 'N/A']);
  eq('the chairs are the app\'s own', vals('Chairs'), fromCode('DEFAULT_CHAIRS'));
  // And the chairs must match the backend's fallback too, or the two books
  // would disagree about what a chair is called.
  const gsChairs = (/items = \[([^\]]+)\]/.exec(CODE)[1].match(/"([^"]*)"/g) || []).map(s => s.slice(1, -1));
  eq('and agree with the backend\'s chair fallback', vals('Chairs'), gsChairs);

  // The headers have to be the ones the app's own savers write, or the next
  // save from Master would reshape the tab under the seeded rows.
  ['Doctor Details', 'Payment Modes', 'Chairs'].forEach(tab => {
    const hdr = api.SEED[tab].header;
    ok(tab + ': header matches what the app writes',
      CODE.indexOf('appendRow(' + JSON.stringify(hdr).replace(/","/g, '", "')) >= 0, hdr);
  });
}

// --- the dry run changes nothing -----------------------------------------
{
  const book = new Book({ 'Payment Modes': [['Mode', 'Updated At']] });
  const { api, logged } = boot(book);
  api.reportMasterSeed();
  eq('the dry run writes nothing', book.tabs['Payment Modes'].rows.length, 1);
  eq('and creates no tabs', book.made, []);
  ok('it says what it would fill', logged.some(l => /Would fill/.test(l)), logged);
}

// --- no confirmation, no write -------------------------------------------
{
  const book = new Book({});
  const { api, logged } = boot(book);
  api.seedMasterLists();
  eq('nothing is written without CONFIRM_SEED', book.made, []);
  ok('and it says why', logged.some(l => /CONFIRM_SEED is not set/.test(l)), logged);
}

// --- the write ------------------------------------------------------------
{
  const book = new Book({ 'Chairs': [['Chair', 'Updated At']] });   // present, empty
  const { api } = boot(book, 'YES');
  api.seedMasterLists();
  eq('an empty tab is filled', book.tabs['Chairs'].rows.length, 5);  // header + 4
  eq('the header comes first', book.tabs['Chairs'].rows[0], ['Chair', 'Updated At']);
  eq('and the values are right', book.tabs['Chairs'].rows.slice(1).map(r => r[0]),
    ['Chair 1', 'Chair 2', 'Chair 3', 'Chair 4']);
  ok('every row is stamped', book.tabs['Chairs'].rows.slice(1).every(r => !!r[r.length - 1]),
    book.tabs['Chairs'].rows[1]);
  eq('a missing tab is created', book.made.sort(), ['Doctor Details', 'Payment Modes']);
  eq('a doctor row has the saver\'s four columns plus the stamp',
    book.tabs['Doctor Details'].rows[1].length, 5);
}

// --- a list the clinic already filled is never replaced -------------------
{
  const book = new Book({
    'Payment Modes': [['Mode', 'Updated At'], ['Only This One', 'x']],
    'Chairs': [['Chair', 'Updated At']],
  });
  const { api, logged } = boot(book, 'YES');
  api.seedMasterLists();
  eq('the clinic\'s own list survives untouched',
    book.tabs['Payment Modes'].rows, [['Mode', 'Updated At'], ['Only This One', 'x']]);
  eq('it was not even cleared', book.tabs['Payment Modes'].cleared, 0);
  ok('and it says so', logged.some(l => /Left alone, already filled.*Payment Modes/.test(l)), logged);
  eq('while the empty one beside it is still filled', book.tabs['Chairs'].rows.length, 5);
}

// --- re-running is a no-op ------------------------------------------------
{
  const book = new Book({});
  const first = boot(book, 'YES'); first.api.seedMasterLists();
  const snapshot = JSON.stringify(book.tabs['Chairs'].rows);
  const second = boot(book, 'YES'); second.api.seedMasterLists();
  eq('running it again changes nothing', JSON.stringify(book.tabs['Chairs'].rows), snapshot);
  ok('and says nothing needed filling',
    second.logged.some(l => /Nothing needed filling/.test(l)), second.logged);
}

let pass = 0, fail = 0;
console.log('\n' + '='.repeat(78));
console.log('SEEDING MASTER WITH WHAT THE APP ALREADY USES');
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
