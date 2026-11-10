// "one thing missing if we want to add department in clinical note template
//  how do we do"
//
// They could not: the departments were a constant in the page, so opening a
// new discipline meant editing code.
//
// They are a list now, and not an ordinary one. The NAME is the key in
// three places -- the 156 templates, both plans, and each of the eighteen
// work-done forms, which names its department in its own definition. So:
//
//   renaming  carries the templates and plan treatments with it, or every
//             one is orphaned under a heading nobody can pick again
//   removing  is refused while anything is still filed under it
//   adding    cannot pin a work-done form to it, and says so rather than
//             letting that be discovered
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
const gs = fs.readFileSync(path.join(REPO, 'apps-script/out/Code.gs'), 'utf8');

const checks = [];
const ok = (name, cond, detail) => checks.push({ name, ok: !!cond, got: detail });
const eq = (name, got, want) => checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });

const CATS = vm.runInNewContext(
  html.slice(html.indexOf('const CLINICAL_TEMPLATE_CATEGORIES = ['),
             html.indexOf(';', html.indexOf('const CLINICAL_TEMPLATE_CATEGORIES = [')))
  + '\nCLINICAL_TEMPLATE_CATEGORIES');
const PINNED = vm.runInNewContext(
  html.slice(html.indexOf('const CLINICAL_FORM_DEPARTMENTS = ['),
             html.indexOf(';', html.indexOf('const CLINICAL_FORM_DEPARTMENTS = [')))
  + '\nCLINICAL_FORM_DEPARTMENTS');

// ── the form pinning, read off the forms themselves ─────────────────────
{
  const forms = html.slice(html.indexOf('{ id:"rct",'), html.indexOf('{ id:"labLog",') + 600);
  const declared = [];
  const re = /templateCategory:"([^"]*)"/g;
  let m;
  while ((m = re.exec(forms))) if (m[1] && m[1] !== '*' && declared.indexOf(m[1]) < 0) declared.push(m[1]);
  eq('the pinned list is the forms\' own, so the two cannot drift', PINNED, declared);
  ok('and every one of them is a department that exists',
     PINNED.every(d => CATS.indexOf(d) >= 0),
     JSON.stringify(PINNED.filter(d => CATS.indexOf(d) < 0)));
  // Departments with no form pinned: real, and the screen must say so.
  ok('some departments have no form pinned, which is the case worth warning about',
     CATS.some(c => PINNED.indexOf(c) < 0),
     JSON.stringify(CATS.filter(c => PINNED.indexOf(c) < 0)));
}

// ── the store ───────────────────────────────────────────────────────────
{
  const src = gs.slice(gs.indexOf('// The departments a template or a plan treatment can be filed under.'),
                       gs.indexOf('function getClinicalNotePlan() {'));
  ok('the store was found', /function saveClinicalDepartmentsList/.test(src), src.length);
  const sheets = {};
  const makeSheet = (name) => ({
    name: name, _rows: [], _max: 26,
    getLastRow() { return this._rows.length; },
    getLastColumn() { return this._rows.reduce((m, r) => Math.max(m, r.length), 0); },
    getMaxColumns() { return this._max; },
    insertColumnsAfter(a, h) { this._max += h; },
    getDataRange() { const r = this._rows; return { getValues: () => r.map(x => x.slice()) }; },
    getRange(row, col, nr, nc) {
      const sh = this;
      return { getValues: () => [], setValues: (vals) => {
        vals.forEach((v, i) => {
          while (sh._rows.length < row + i) sh._rows.push([]);
          v.forEach((x, j) => { sh._rows[row - 1 + i][col - 1 + j] = x; });
        });
      } };
    },
    appendRow(r) { this._rows.push(r.slice()); },
    clearContents() { this._rows = []; }
  });
  const ctx = {
    getSheet: (n) => (sheets[n] = sheets[n] || makeSheet(n)),
    parseList_: (v) => { try { return JSON.parse(v); } catch (e) { return { __bad: 'bad' }; } },
    Date, String, JSON
  };
  vm.createContext(ctx);
  vm.runInContext(src + '\nthis.get = getClinicalDepartmentsList; this.save = saveClinicalDepartmentsList;', ctx);

  eq('empty reads as empty', ctx.get(), { success: true, departments: [] });
  eq('a list is accepted', ctx.save({ departments: JSON.stringify(['RCT', 'Oral Medicine']) }),
     { success: true, saved: 2 });
  eq('and comes back in order', ctx.get().departments, ['RCT', 'Oral Medicine']);
  eq('its own sheet', Object.keys(sheets), ['Clinical Departments']);
  eq('with a heading row', sheets['Clinical Departments']._rows[0], ['Department', 'Updated At']);
  // Blanks and duplicates would both put a nameless or doubled option in
  // every dropdown in Clinical Configuration.
  ctx.save({ departments: JSON.stringify(['RCT', '', '  ', 'RCT', 'Oral Medicine']) });
  eq('blanks are dropped and duplicates collapse on the way out',
     ctx.get().departments, ['RCT', 'Oral Medicine']);
  eq('rubbish is refused', ctx.save({ departments: 'not json' }).success, false);
  ok('and it is routed',
     /case "getClinicalDepartmentsList":/.test(gs) && /case "saveClinicalDepartmentsList":/.test(gs));
}

// ── the dropdowns follow the saved list ─────────────────────────────────
ok('both editors take the departments, falling back to the built-in list',
   (html.match(/const CATS = \(categories && categories\.length\) \? categories : CLINICAL_TEMPLATE_CATEGORIES;/g) || []).length === 2);
ok('and are given them',
   /seed: CLINICAL_NOTE_TEMPLATE_SEED, categories: clinDepts/.test(html) &&
   (html.match(/seed: CLINICAL_NOTE_PLAN_SEED, categories: clinDepts/g) || []).length === 2);
ok('saved through persist, like every other list here',
   /const saveClinDepts = \(arr\) => persist\("saveClinicalDepartmentsList", \{ departments: JSON\.stringify\(arr\) \}, arr, setClinDepts, clinDepts\);/.test(html));
ok('and read in the one request Master already makes',
   /"getClinicalNoteTemplateLib", "getClinicalDepartmentsList"/.test(html) &&
   /if \(cd && cd\.success\) setClinDepts\(cd\.departments \|\| \[\]\);/.test(html));

// ── the screen ──────────────────────────────────────────────────────────
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String((e && e.message) || e)));
  await page.setContent('<body style="margin:0;padding:16px;font-family:system-ui"><div id="root"></div></body>');
  for (const f of ['node_modules/react/umd/react.production.min.js',
                   'node_modules/react-dom/umd/react-dom.production.min.js'])
    await page.addScriptTag({ content: fs.readFileSync(path.join(REPO, f), 'utf8') });
  await page.addScriptTag({ content: `
    const T="#0078B4", BORDER="#e5e5e0", BGS="#f5f5f0", TL="#DCF4FB";
    const inp={padding:"6px 10px",fontSize:14,border:"1px solid #e5e5e0",borderRadius:6,
               background:"#fff",color:"#1a1a1a",boxSizing:"border-box",fontFamily:"inherit"};
    window.__depts = null; window.__tpl = null; window.__plan = null;
    window.confirm = () => true;
  ` });
  await page.addScriptTag({ content:
    html.slice(html.indexOf('const CLINICAL_FORM_DEPARTMENTS = ['),
               html.indexOf('const CLINICAL_TEMPLATE_CATEGORIES = [')) });
  // KB_CLIN_TXT and the two shared bits live just above in the real page.
  await page.addScriptTag({ content:
    html.slice(html.indexOf('const KB_CLIN_TXT = '), html.indexOf('function KbClinRowBtns'))
    + html.slice(html.indexOf('function KbClinRowBtns'), html.indexOf('function KbClinGroups')) });
  await page.addScriptTag({ content: `
    const CLINICAL_TEMPLATE_CATEGORIES = ${JSON.stringify(CATS)};
  ` });

  const DEPTS = ['RCT', 'Periodontics', 'Oral Medicine'];
  const TPL = [
    { category: 'RCT', template: 'Access Opening', type1: 'a', type2: 'b' },
    { category: 'RCT', template: 'Working Length', type1: 'c', type2: 'd' },
    { category: 'Periodontics', template: 'Flap Surgery', type1: 'e', type2: 'f' }
  ];
  const PLAN = [
    { plan: 'Normal', treatment: 'RCT - Access Open', category: 'RCT', templates: 'Access Opening' },
    { plan: 'CGHS', treatment: 'Flap Surgery- Per Tooth', category: 'Periodontics', templates: 'Flap Surgery' }
  ];

  const mount = async (depts) => {
    await page.evaluate(({ depts, TPL, PLAN, CATS }) => {
      window.__depts = null; window.__tpl = null; window.__plan = null;
      const root = document.getElementById('root');
      ReactDOM.render(null, root);
      ReactDOM.render(React.createElement(ClinicalDepartmentEditor, {
        key: String(Math.random()), departments: depts, templates: TPL, plan: PLAN,
        builtIn: CATS, saving: false,
        onSave: (v) => { window.__depts = v; },
        onSaveTemplates: (v) => { window.__tpl = v; },
        onSavePlan: (v) => { window.__plan = v; }
      }), root);
    }, { depts, TPL, PLAN, CATS });
    await page.waitForTimeout(110);
  };
  const text = () => page.$eval('#root', el => el.innerText.replace(/\s+/g, ' ').trim());
  const got = () => page.evaluate(() => ({ depts: window.__depts, tpl: window.__tpl, plan: window.__plan }));
  const button = (re) => page.evaluateHandle((src) => {
    const rx = new RegExp(src, 'i');
    return [...document.querySelectorAll('button')].find(b => rx.test(b.innerText)) || null;
  }, re);
  const rowBtn = (name, label) => page.evaluate(({ name, label }) => {
    const row = [...document.querySelectorAll('span')]
      .find(sp => sp.textContent.trim() === name).parentElement;
    [...row.querySelectorAll('button')].find(b => b.textContent.trim() === label).click();
  }, { name, label });

  // Nothing saved: the built-in list, offered.
  await mount([]);
  let t = await text();
  ok('with nothing saved it offers the built-in departments',
     /No departments saved yet/.test(t) && new RegExp('Save the ' + CATS.length + ' departments').test(t), t);
  await (await button('Save the ')).asElement().click();
  await page.waitForTimeout(110);
  eq('which saves them as they stand', (await got()).depts, CATS);

  // What each is used for, on the row.
  await mount(DEPTS);
  t = await text();
  ok('each department says what is filed under it',
     /RCT 2 templates . 1 on the plans/.test(t) && /Periodontics 1 template . 1 on the plans/.test(t), t);
  ok('and one with nothing says so', /Oral Medicine nothing filed under it/.test(t), t);
  // A department no work-done form is pinned to.
  ok('a department with no form pinned is flagged on its row',
     /Oral Medicine[\s\S]{0,60}no form pinned/.test(t), t);
  ok('and one that has a form is not', !/RCT 2 templates . 1 on the plans no form pinned/.test(t), t);

  // Adding.
  await mount(DEPTS);
  await page.locator('input').first().fill('Oral Surgery');
  await (await button('^Add$')).asElement().click();
  await page.waitForTimeout(110);
  eq('a new department is appended', (await got()).depts, [...DEPTS, 'Oral Surgery']);
  ok('and the screen says no form is pinned to it yet',
     /No work-done form is pinned to it/.test(await text()), await text());

  await mount(DEPTS);
  await page.locator('input').first().fill('rct');
  await (await button('^Add$')).asElement().click();
  await page.waitForTimeout(110);
  eq('a duplicate is refused, whatever case it is typed in', (await got()).depts, null);
  ok('and says why', /is already on the list/.test(await text()), await text());

  // Renaming, which is the whole reason this is not a plain list.
  await mount(DEPTS);
  await rowBtn('RCT', 'Edit');
  await page.waitForTimeout(80);
  await page.locator('input').nth(1).fill('RCT / Endodontics');
  await (await button('^Save$')).asElement().click();
  await page.waitForTimeout(110);
  let g = await got();
  eq('the department is renamed', g.depts, ['RCT / Endodontics', 'Periodontics', 'Oral Medicine']);
  eq('its templates come with it',
     g.tpl.map(x => x.category), ['RCT / Endodontics', 'RCT / Endodontics', 'Periodontics']);
  eq('and so do its plan treatments',
     g.plan.map(x => x.category), ['RCT / Endodontics', 'Periodontics']);
  eq('nothing else is touched', [g.tpl[2].template, g.plan[1].treatment],
     ['Flap Surgery', 'Flap Surgery- Per Tooth']);
  t = await text();
  ok('and it says what moved', /2 templates and 1 plan treatment moved with it/.test(t), t);
  ok('and warns that a form was pinned to the old name',
     /that pinning is in the form's own definition/.test(t), t);

  // Renaming something nothing uses touches nothing else.
  await mount(DEPTS);
  await rowBtn('Oral Medicine', 'Edit');
  await page.waitForTimeout(80);
  await page.locator('input').nth(1).fill('Oral Medicine & Radiology');
  await (await button('^Save$')).asElement().click();
  await page.waitForTimeout(110);
  g = await got();
  eq('the rename lands', g.depts[2], 'Oral Medicine & Radiology');
  eq('and nothing is rewritten for nothing', [g.tpl, g.plan], [null, null]);

  // Removing. The one that must be refused.
  await mount(DEPTS);
  await rowBtn('RCT', 'Remove');
  await page.waitForTimeout(110);
  g = await got();
  eq('a department in use is not removed', g.depts, null);
  t = await text();
  ok('and it says exactly what is in the way',
     /still has 2 templates and 1 plan treatment filed under it/.test(t), t);
  ok('and why that matters',
     /under a heading nobody can pick again/.test(t), t);

  await mount(DEPTS);
  await rowBtn('Oral Medicine', 'Remove');
  await page.waitForTimeout(110);
  eq('one with nothing filed under it goes',
     (await got()).depts, ['RCT', 'Periodontics']);

  eq('nothing threw', errors, []);
  await browser.close();

  let pass = 0, fail = 0;
  checks.forEach(c => {
    if (c.ok) pass++;
    else {
      fail++;
      console.log('  FAIL  ' + c.name +
        (c.want !== undefined ? '\n          got ' + JSON.stringify(c.got) + ', wanted ' + JSON.stringify(c.want)
         : c.got !== undefined ? '\n          ' + String(c.got).slice(0, 300) : ''));
    }
  });
  console.log('  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL  the harness itself: ' + (e && e.stack || e)); process.exit(1); });
