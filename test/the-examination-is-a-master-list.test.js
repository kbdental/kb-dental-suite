// "We move to the next thing the examination master"
//
// The Care Plan's examination was seventeen findings written into the page:
// which sections exist, what is checked under each, and how each is
// answered. A clinic that wanted to start checking the tonsils had to ask
// for a release. It is a list, so it belongs in Master with the other lists.
//
// Two shapes, which the page already had and the master keeps:
//   healthy  a Healthy tick, or an observation written instead  (Jaw Joints)
//   present  a Present tick, with a note of where               (Swelling)
//
// The key is what a saved care plan stores the answer under. It is fixed
// when a finding is created and a rename never touches it -- renaming
// "Swelling" must relabel old plans, not orphan their answers.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
const gs = fs.readFileSync(path.join(REPO, 'apps-script/out/Code.gs'), 'utf8');
const cut = (a, b) => html.slice(html.indexOf(a), html.indexOf(b, html.indexOf(a)));

const checks = [];
const ok = (name, cond, detail) => checks.push({ name, ok: !!cond, got: detail });
const eq = (name, got, want) => checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });

// ── the seed is exactly what the page used to hold ──────────────────────
const ctx = { String, Object, Array, console };
vm.createContext(ctx);
vm.runInContext(cut('const CLINICAL_EXAM_SEED = [', 'const CLINICAL_NOTE_TEMPLATE_SEED')
  + '\nthis.SEED = CLINICAL_EXAM_SEED; this.KINDS = CLINICAL_EXAM_KINDS; this.keyOf = clinicalExamKey;', ctx);
const { SEED, KINDS, keyOf } = ctx;

eq('the seventeen findings are all there', SEED.length, 17);
eq('under the four sections the page was built around',
   SEED.map(r => r[0]).filter((s, i, a) => a.indexOf(s) === i),
   ['Extra-Oral Check', 'Intra-Oral Check', 'Gum Assessment', 'Wasting Disease']);
eq('six are answered Healthy-or-observation', SEED.filter(r => r[2] === 'healthy').length, 6);
eq('and eleven Present-with-a-note', SEED.filter(r => r[2] === 'present').length, 11);
eq('only those two shapes exist',
   KINDS.map(k => k[0]).sort(), ['healthy', 'present']);
// The keys are the ones saved care plans already use. A typo here loses a
// column of answers on every plan in the sheet.
['jawJoints', 'lymphNodes', 'swelling', 'lipCompetency', 'facialAsymmetry', 'tongue',
 'palate', 'floorMouth', 'buccalMucosa', 'bleedingProbing', 'gumRecession', 'furcation',
 'mobility', 'abrasion', 'attrition', 'abfraction', 'erosion'].forEach(k =>
  ok('a plan saved under "' + k + '" still reads back', SEED.some(r => r[3] === k), ''));
// And those keys must be the ones the stored plan actually uses.
const defaults = cut('const emptyCP2 = {', '\n};');
SEED.forEach(r => ok('the care plan has a slot for ' + r[3],
  new RegExp('\\b' + r[3] + ':\\s*' + (r[2] === 'healthy' ? 'hp' : 'pp') + '\\(\\)').test(defaults), ''));

// ── a new finding gets a key of its own, and a rename never moves it ───
eq('a new finding is keyed from its name', keyOf('Mouth Breathing', []), 'mouthBreathing');
eq('punctuation and case do not matter', keyOf('Floor of Mouth!', []), 'floorOfMouth');
eq('a clash is avoided rather than overwritten',
   keyOf('Swelling', ['swelling']), 'swelling2');
eq('and a nameless one still gets something', keyOf('   ', []), 'finding');
const editor = cut('function ClinicalExaminationEditor(', '// ── Master → Clinical Configuration → Clinical Note Templates');
ok('a rename carries the old key over, so old answers are relabelled not lost',
   /key: txt\(r\.key\) \|\| clinicalExamKey/.test(editor), '');
ok('and says so where it is done', /must not orphan the\s*\/\/ *answers/.test(editor), '');

// ── the backend keeps it ────────────────────────────────────────────────
ok('the backend offers the list', /case "getClinicalExaminationList":/.test(gs), '');
ok('and saving it', /case "saveClinicalExaminationList":/.test(gs), '');
const sheets = {};
const makeSheet = () => ({
  _rows: [], _max: 26,
  getLastRow() { return this._rows.length; },
  getMaxColumns() { return this._max; },
  getLastColumn() { return this._rows.reduce((m, r) => Math.max(m, r.length), 0); },
  insertColumnsAfter(a, n) { this._max += n; },
  getDataRange() { const r = this._rows; return { getValues: () => r.map(x => x.slice()) }; },
  getRange(row, col, nr, nc) {
    const sh = this;
    return { getValues: () => [], setValues: (vals) => vals.forEach((v, i) => {
      while (sh._rows.length < row + i) sh._rows.push([]);
      v.forEach((x, j) => { sh._rows[row - 1 + i][col - 1 + j] = x; });
    }) };
  },
  appendRow(r) { this._rows.push(r.slice()); },
  clearContents() { this._rows = []; }
});
const fn = (name) => {
  const a = gs.indexOf('function ' + name + '(');
  return gs.slice(a, gs.indexOf('\n}', a) + 2) + '\n';
};
const back = {
  getSheet: (n) => sheets[n] || (sheets[n] = makeSheet()),
  ensureGridWidth_: () => {},
  parseList_: (v) => { try { return JSON.parse(v); } catch (e) { return { __bad: 'bad' }; } },
  CLINICAL_EXAM_SHEET: 'Clinical Examination',
  CLINICAL_EXAM_HEADERS: ['Section', 'Finding', 'Kind', 'Key', 'Updated At'],
  String, Object, Array, JSON, Date, console
};
vm.createContext(back);
vm.runInContext(fn('getClinicalExaminationList') + fn('saveClinicalExaminationList')
  + '\nthis.get = getClinicalExaminationList; this.save = saveClinicalExaminationList;', back);

back.save({ findings: JSON.stringify(SEED.map(r => ({ section: r[0], finding: r[1], kind: r[2], key: r[3] }))) });
let got = back.get().findings;
eq('all seventeen come back', got.length, 17);
eq('with their section, shape and key', got[0],
   { section: 'Extra-Oral Check', finding: 'Jaw Joints', kind: 'healthy', key: 'jawJoints' });
eq('the clinic\'s own order is kept, not sorted', got.map(r => r.finding)[16], 'Erosion');
// A row with no finding is not a finding.
back.save({ findings: JSON.stringify([{ section: 'A', finding: '', kind: 'present', key: 'x' },
                                      { section: 'A', finding: 'Real', kind: 'present', key: 'real' }]) });
eq('a blank row is dropped rather than saved', back.get().findings.length, 1);
eq('a shape left off defaults to Present', (() => {
  back.save({ findings: JSON.stringify([{ section: 'A', finding: 'Thing', key: 'thing' }]) });
  return back.get().findings[0].kind;
})(), 'present');
eq('bad JSON is refused rather than thrown', back.save({ findings: '{nope' }).success, false);

// ── and the Care Plan draws from it, screen and paper ──────────────────
const carePlan = cut('function CarePlan(', '\nfunction KbClin');
ok('the care plan reads the master list', /const examList = useExaminationList\(\);/.test(carePlan), '');
ok('and falls back to the seventeen when there is none',
   /CLINICAL_EXAM_SEED\.map\(r => \(\{ section:r\[0\]/.test(html), '');
ok('each row is drawn by its shape',
   /const Row = healthy \? HRow : PRow;/.test(carePlan), '');
ok('a finding with no answer yet does not crash the plan',
   /p2\[r\.key\] \|\| \(healthy \? hp\(\) : pp\(\)\)/.test(carePlan), '');
ok('sections the clinic adds are drawn too', /examExtra\.map\(sec =>/.test(carePlan), '');
// The printed page is the medico-legal record. If it still listed findings
// by name, the paper and the screen would disagree the day one is added.
ok('the printed page is built from the same list', /const examCells = \(section\) =>/.test(carePlan), '');
['jawJoints', 'tongue', 'bleedingProbing', 'erosion'].forEach(k =>
  ok('the printed page no longer names ' + k + ' itself',
     !new RegExp('lbl">[^<]*</div><div class="val">\\$\\{(hf|pf)\\(p2\\.' + k + '\\)').test(carePlan), ''));

(async () => {
  const LOCAL = {
    'react/18.2.0/umd/react.production.min.js': 'node_modules/react/umd/react.production.min.js',
    'react-dom/18.2.0/umd/react-dom.production.min.js': 'node_modules/react-dom/umd/react-dom.production.min.js'
  };
  // A list with a finding the page never had, in a section it never had.
  const FINDINGS = [
    ['Extra-Oral Check', 'Jaw Joints', 'healthy', 'jawJoints'],
    ['Extra-Oral Check', 'Swelling', 'present', 'swelling'],
    ['Intra-Oral Check', 'Tonsils', 'healthy', 'tonsils'],
    ['Gum Assessment', 'Mobility', 'present', 'mobility'],
    ['Wasting Disease', 'Abrasion', 'present', 'abrasion'],
    ['Airway', 'Mouth Breathing', 'present', 'mouthBreathing']
  ].map(r => ({ section: r[0], finding: r[1], kind: r[2], key: r[3] }));

  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
  await page.route('**cdnjs.cloudflare.com/**', r => {
    const u = r.request().url();
    const h = Object.keys(LOCAL).find(k => u.indexOf(k) >= 0);
    return r.fulfill({ status: 200, contentType: 'application/javascript',
      body: h ? fs.readFileSync(path.join(REPO, LOCAL[h]), 'utf8') : '/* not needed */' });
  });
  await page.route('**script.google.com/**', r => {
    const body = r.request().postData() || r.request().url();
    return r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(/getClinicalExaminationList/.test(body)
        ? { success: true, findings: FINDINGS } : { success: true }) });
  });
  const errors = [];
  page.on('pageerror', e => errors.push(String((e && e.message) || e)));
  await page.goto('file://' + path.join(REPO, 'index.html'));
  await page.waitForTimeout(2300);
  await page.getByText('Care Plan', { exact: false }).first().click();
  await page.waitForTimeout(1400);
  for (const label of ['2', 'Examination', 'Next']) {
    const l = page.locator('button', { hasText: new RegExp('^' + label) }).first();
    if (await l.count()) { await l.click().catch(() => {}); await page.waitForTimeout(700); break; }
  }
  const t = await page.evaluate(() => {
    const el = document.querySelector('[data-kb-page]');
    return (el && el.innerText.replace(/\s+/g, ' ')) || '';
  });
  ok('a finding in the list is on the examination', t.indexOf('Jaw Joints') >= 0, t.slice(0, 200));
  ok('including one the page never had', t.indexOf('Tonsils') >= 0, t.slice(0, 200));
  ok('a section the clinic added appears, with its finding',
     /airway/i.test(t) && t.indexOf('Mouth Breathing') >= 0, t.slice(0, 240));
  // Not in the list means not asked. That is the point of the list.
  ok('a finding taken off the list is no longer asked',
     t.indexOf('Palate') < 0 && t.indexOf('Erosion') < 0, t.slice(0, 240));
  eq('nothing threw', errors, []);
  await browser.close();

  let pass = 0, fail = 0;
  checks.forEach(c => {
    if (c.ok) pass++;
    else {
      fail++;
      console.log('  FAIL  ' + c.name +
        (c.want !== undefined ? '\n          got ' + JSON.stringify(c.got) + ', wanted ' + JSON.stringify(c.want)
         : c.got ? '\n          ' + c.got : ''));
    }
  });
  console.log('  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL  the harness itself: ' + (e && e.stack || e)); process.exit(1); });
