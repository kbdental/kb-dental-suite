// Same tooth, same patient, two meanings:
//
//   continuing   — access opening one visit, obturation the next. One course
//                  of treatment, one entry, updated.
//   retreatment  — a new course years later. Its own entry, and the first
//                  course must survive rather than be written over.
//
// The form cannot tell these apart from the gap between visits: a slow-running
// treatment and a quick retreatment look identical. So continuing stays the
// default and a new course is started explicitly, by a button.
//
// What the printed sheet reads is `entries`, which keeps ONE row per tooth —
// the course in progress — so the four-tooth paper layout is untouched and
// finished courses live in that entry's `past`.

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');

const checks = [];
const eq = (name, got, want) =>
  checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });
const ok = (name, cond, detail) => checks.push({ name, ok: !!cond, got: detail, want: 'truthy' });

const m = /RCT_FORM_B64\s*=\s*((?:"[^"]*"\s*\+?\s*)+);/.exec(html);
const form = Buffer.from((m[1].match(/"([^"]*)"/g) || [])
  .map(s => s.slice(1, -1)).join(''), 'base64').toString('utf8');

(async () => {
  const file = path.join(os.tmpdir(), 'kb-rct-course.html');
  fs.writeFileSync(file, form);
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
  const page = await browser.newPage();
  let accept = true;
  page.on('dialog', d => accept ? d.accept() : d.dismiss());
  await page.goto('file://' + file);
  await page.waitForTimeout(400);

  const setPatient = (id) => page.evaluate((id) => {
    document.getElementById('pId').value = id;
    document.getElementById('pName').value = 'Patient ' + id;
  }, id);
  const save = (tooth) => page.evaluate((t) => {
    window.selTooth = t;
    document.getElementById('saveToSheet').click();
  }, tooth);
  const newCourse = (tooth) => page.evaluate((t) => {
    window.selTooth = t;
    document.getElementById('newCourse').click();
  }, tooth);
  const sheet = () => page.evaluate(() => {
    const k = Object.keys(localStorage).find(k => k.indexOf('kb_rct_sheet_') === 0);
    return k ? JSON.parse(localStorage.getItem(k) || '{}') : {};
  });
  const typeNote = (txt) => page.evaluate((t) => {
    const el = document.getElementById('n1'); if (el) el.value = t;
  }, txt);

  await setPatient('AL0801');

  // --- course 1 -----------------------------------------------------------
  await typeNote('first course notes');
  await save('26');
  await page.waitForTimeout(100);
  let s = await sheet();
  eq('a first treatment is course 1', s.entries.map(e => e.course), [1]);
  eq('with nothing behind it', s.entries[0].past, []);

  // --- continuing it: still one entry, still course 1 ----------------------
  await typeNote('second visit, same course');
  await save('26');
  await page.waitForTimeout(100);
  s = await sheet();
  eq('continuing does not add an entry', s.entries.length, 1);
  eq('and does not advance the course', s.entries[0].course, 1);
  eq('nor invent a history', s.entries[0].past, []);

  // --- the retreatment ----------------------------------------------------
  await newCourse('26');
  await page.waitForTimeout(150);
  s = await sheet();
  eq('a new course still leaves ONE row for the tooth', s.entries.length, 1);
  eq('and it is course 2', s.entries[0].course, 2);
  eq('the finished course is kept', (s.entries[0].past || []).length, 1);
  eq('as course 1', s.entries[0].past[0].course, 1);
  ok('with its own work on it',
    JSON.stringify(s.entries[0].past[0]).indexOf('second visit, same course') >= 0,
    Object.keys(s.entries[0].past[0]));
  // Nesting history inside history would grow without bound.
  eq('history is not stored recursively', s.entries[0].past[0].past, undefined);
  eq('the patient is carried over', s.entries[0].pId, 'AL0801');

  // The form must be ready for the new course, not still showing the old one.
  eq('the form is cleared for the new course',
    await page.evaluate(() => (document.getElementById('n1') || {}).value), '');

  // --- and course 2 then behaves like any other course --------------------
  await typeNote('retreatment notes');
  await save('26');
  await page.waitForTimeout(100);
  s = await sheet();
  eq('saving the new course updates it in place', s.entries.length, 1);
  eq('it is still course 2', s.entries[0].course, 2);
  eq('and course 1 is still there', (s.entries[0].past || []).length, 1);

  // --- a tooth with no record has no earlier course to follow -------------
  accept = false;  // the confirm must never be reached
  await newCourse('11');
  await page.waitForTimeout(100);
  s = await sheet();
  eq('a new course on an untreated tooth adds nothing', s.entries.length, 1);

  await browser.close();
  fs.unlinkSync(file);

  // --- the printed sheet reads entries, which stayed one row per tooth ----
  ok('the print builder still reads entries', /function buildClinRec\(\)[\s\S]{0,200}sheet\.entries/.test(form));

  let pass = 0, fail = 0;
  console.log('\n' + '='.repeat(78));
  console.log('RETREATMENT IS A NEW COURSE; CONTINUING IS NOT');
  console.log('='.repeat(78));
  for (const c of checks) {
    c.ok ? pass++ : fail++;
    console.log((c.ok ? '  PASS  ' : '  FAIL  ') + c.name +
      (c.ok ? '' : `\n          expected ${JSON.stringify(c.want)}, got ${JSON.stringify(c.got)}`));
  }
  console.log('='.repeat(78));
  console.log(`  ${pass} passed, ${fail} failed`);
  console.log('='.repeat(78));
  process.exit(fail ? 1 : 0);
})();
