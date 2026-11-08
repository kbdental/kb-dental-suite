// "replace the Clinical note template with the one in this sheet and they be
//  called a Type 1 (concise) and Type 2 (Comprehensive)"
//  ... "They should be replaced with Templates according to Plan"
//
// Then: "The Plan tab needs to be separate ... and push the plan from the
//  sheet to plan and also Plan CGHS"
//
// So THREE things, kept apart:
//   the TEMPLATES  156, one per procedure, each in two lengths
//   the PLAN       277 treatments -- 156 the clinic's own, 121 CGHS -- each
//                  naming the templates it is made of
//
// They were briefly one store keyed by plan treatment. That duplicated
// every note once per plan item that used it, so a template corrected in
// one place stayed wrong in the others. A plan item refers to templates BY
// NAME, and all 364 references resolve, which is what makes the split safe.
//
// The thing that must not break: eighteen work-done forms and the CGHS
// prescription already ask for {situation, text, category}. They are base64
// blobs, and rebuilding a dropdown eighteen times is eighteen chances to
// break a form that was working. So they keep getting exactly that shape,
// derived from the plan.
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

// ── the clinic's own templates and plan ─────────────────────────────────
const read = (constName) => vm.runInNewContext(
  html.slice(html.indexOf('const ' + constName + ' = ['),
             html.indexOf('\n];', html.indexOf('const ' + constName + ' = [')) + 3)
  + '\n' + constName);

const TPL = read('CLINICAL_NOTE_TEMPLATE_SEED');
const PLAN = read('CLINICAL_NOTE_PLAN_SEED');
const CATS = vm.runInNewContext(
  html.slice(html.indexOf('const CLINICAL_TEMPLATE_CATEGORIES = ['),
             html.indexOf(';', html.indexOf('const CLINICAL_TEMPLATE_CATEGORIES = [')))
  + '\nCLINICAL_TEMPLATE_CATEGORIES');

eq('every template the clinic wrote is there', TPL.length, 156);
ok('each is department, template, Type 1, Type 2',
   TPL.every(r => r.length === 4 && r.every(x => typeof x === 'string' && x.trim())),
   JSON.stringify((TPL.find(r => r.length !== 4 || r.some(x => typeof x !== 'string' || !x.trim())) || []).slice(0, 2)));
eq('no two templates share a name', TPL.length, new Set(TPL.map(r => r[1])).size);
// Type 2 is the longer one by definition. The wrong way round and the full
// record would print as the short one.
eq('the comprehensive note is never shorter than the concise one',
   TPL.filter(r => r[3].length < r[2].length).map(r => r[1]), []);
ok('every template falls under a department the editor offers',
   TPL.every(r => CATS.indexOf(r[0]) >= 0),
   JSON.stringify([...new Set(TPL.filter(r => CATS.indexOf(r[0]) < 0).map(r => r[0]))]));
// The sheet said "Restorations"; the clinic standardised on "Restoration"
// last week and the Restoration form picks by that name.
ok('the department the sheet spelled differently was brought into line',
   TPL.some(r => r[0] === 'Restoration') && !TPL.some(r => r[0] === 'Restorations'));

eq('every plan treatment is there', PLAN.length, 277);
eq('on the two plans', [PLAN.filter(r => r[0] === 'Normal').length,
                        PLAN.filter(r => r[0] === 'CGHS').length], [156, 121]);
ok('each is plan, treatment, department, templates',
   PLAN.every(r => r.length === 4 && r[1].trim() && r[2].trim() && r[3].trim()),
   JSON.stringify((PLAN.find(r => r.length !== 4 || !(r[1].trim() && r[2].trim() && r[3].trim())) || []).slice(0, 3)));
ok('and the plan carries no copy of the note text',
   PLAN.every(r => r.length === 4), 'a plan row is wider than four columns');

// ── the references, resolved the way the screen resolves them ───────────
{
  const ctx = { String };
  vm.createContext(ctx);
  vm.runInContext(html.slice(html.indexOf('function clinicalTemplateRefs(cell) {'),
                             html.indexOf('const KB_CLIN_TXT'))
    + '\nthis.refs = clinicalTemplateRefs;', ctx);
  const refs = ctx.refs;

  eq('one template is one reference', refs('Consultation'), ['Consultation']);
  eq('an arrow means one after another',
     refs('Access Opening → Working Length'), ['Access Opening', 'Working Length']);
  eq('"or" means a choice',
     refs('Composite – Posterior / or Composite – Anterior'),
     ['Composite – Posterior', 'Composite – Anterior']);
  // The one that must not be split: a bare slash is part of the NAME.
  eq('a slash inside a name is left alone',
     refs('Denture Addition (Tooth / Clasp)'), ['Denture Addition (Tooth / Clasp)']);
  eq('nothing named is no references', refs(''), []);
  eq('and neither is nothing at all', refs(undefined), []);

  // Every reference in the clinic's plan must name a template that exists,
  // or that plan treatment writes nothing and the screen is the only place
  // it would ever show.
  const names = new Set(TPL.map(r => r[1]));
  const dangling = [];
  PLAN.forEach(r => refs(r[3]).forEach(n => { if (!names.has(n)) dangling.push(r[1] + ' → ' + n); }));
  eq('every reference in the plan resolves to a template', dangling, []);
  eq('and there are plenty of them to get wrong',
     PLAN.reduce((n, r) => n + refs(r[3]).length, 0), 364);
}

// ── two stores, run ─────────────────────────────────────────────────────
{
  const src = gs.slice(gs.indexOf('// ── Three things, kept apart ─'),
                       gs.indexOf('function getPatientOutstanding(p) {'));
  ok('the backend code was found', /function clinicalTemplatesFlat_/.test(src), src.length);

  const sheets = {};
  const makeSheet = (name) => ({
    name: name, _rows: [], _max: 26,
    getName() { return this.name; }, setName(n) { this.name = n; },
    getLastRow() { return this._rows.length; },
    getLastColumn() { return this._rows.reduce((m, r) => Math.max(m, r.length), 0); },
    getMaxColumns() { return this._max; },
    insertColumnsAfter(a, h) { this._max += h; },
    getDataRange() { const r = this._rows; return { getValues: () => r.map(x => x.slice()) }; },
    getRange(row, col, nr, nc) {
      const sh = this;
      return {
        getValues: () => {
          const out = [];
          for (let i = 0; i < nr; i++) {
            const r = sh._rows[row - 1 + i] || [], v = [];
            for (let j = 0; j < nc; j++) v.push(r[col - 1 + j] === undefined ? '' : r[col - 1 + j]);
            out.push(v);
          }
          return out;
        },
        setValues: (vals) => {
          vals.forEach((v, i) => {
            while (sh._rows.length < row + i) sh._rows.push([]);
            v.forEach((x, j) => { sh._rows[row - 1 + i][col - 1 + j] = x; });
          });
        }
      };
    },
    appendRow(r) { this._rows.push(r.slice()); },
    clearContents() { this._rows = []; }
  });
  const ss = { getSheetByName: (n) => sheets[n] || null,
               insertSheet: (n) => (sheets[n] = makeSheet(n)), _sheets: sheets };
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    getSheet: (n) => sheets[n] || ss.insertSheet(n),
    ensureGridWidth_: (sh, n) => { if (n > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), n - sh.getMaxColumns()); },
    parseList_: (v) => { try { return JSON.parse(v); } catch (e) { return { __bad: 'not a list' }; } },
    CLINICAL_NOTE_SEED: [],
    Date, String, JSON, Math
  };
  vm.createContext(ctx);
  vm.runInContext(src + '\nthis.getLib = getClinicalNoteTemplateLib; this.saveLib = saveClinicalNoteTemplateLib;'
    + ' this.getPlan = getClinicalNotePlan; this.savePlan = saveClinicalNotePlan;'
    + ' this.getTpl = getClinicalNoteTemplates;', ctx);

  eq('an empty library reads as empty', ctx.getLib(), { success: true, rows: [] });
  eq('an empty plan reads as empty', ctx.getPlan(), { success: true, rows: [] });

  const LIB = [
    { category: 'RCT', template: 'Access Opening', type1: 'Access opening done wrt {tooth}.',
      type2: 'Access opening done wrt {tooth} under {anaesthesia}.' },
    { category: 'RCT', template: 'Working Length', type1: 'WL recorded wrt {tooth}.', type2: '' },
    { category: 'Periodontics', template: 'Flap Surgery', type1: 'Flap raised wrt {tooth}.',
      type2: 'Flap raised wrt {tooth} under {anaesthesia}, sutured.' }
  ];
  const ROWS = [
    { plan: 'Normal', treatment: 'RCT - Access Open', category: 'RCT',
      templates: 'Access Opening → Working Length' },
    { plan: 'CGHS', treatment: 'Flap Surgery- Per Tooth', category: 'Periodontics',
      templates: 'Flap Surgery' }
  ];
  eq('the library is accepted', ctx.saveLib({ rows: JSON.stringify(LIB) }), { success: true, saved: 3 });
  eq('and comes back as it went in', ctx.getLib().rows, LIB);
  eq('the plan is accepted', ctx.savePlan({ rows: JSON.stringify(ROWS) }), { success: true, saved: 2 });
  // A plan treatment also carries the Hindi a patient reads; a row saved
  // without it comes back with an empty one rather than the field missing.
  eq('and comes back as it went in',
     ctx.getPlan().rows, ROWS.map(r => ({ ...r, hindi: '' })));

  // The thing that was actually broken: two tables answering to one name.
  // Each read found the other's heading row, moved that sheet aside and made
  // a fresh one, so two tabs were shuffled on every single read.
  eq('they are separate sheets', Object.keys(sheets).sort(),
     ['Clinical Note Plan', 'Clinical Templates (Type 1 & 2)']);
  eq('and neither is the older table\'s name',
     Object.keys(sheets).indexOf('Clinical Note Templates'), -1);
  const before = JSON.stringify(sheets);
  ctx.getTpl(); ctx.getTpl(); ctx.getTpl();
  eq('reading three times renames nothing and writes nothing',
     JSON.stringify(sheets), before);

  eq('the library has its own headings', sheets['Clinical Templates (Type 1 & 2)']._rows[0],
     ['Category', 'Template', 'Type 1 (Concise)', 'Type 2 (Comprehensive)', 'Updated At']);
  eq('and the plan has its own', sheets['Clinical Note Plan']._rows[0],
     ['Plan', 'Plan Treatment', 'Category', 'Templates', 'Updated At', 'Hindi']);
  ok('each goes in one block, not one call per row',
     /sh\.getRange\(2, 1, block\.length, CLINICAL_TPL_LIB_HEADERS\.length\)\.setValues\(block\)/.test(src) &&
     /sh\.getRange\(2, 1, block\.length, CLINICAL_PLAN_HEADERS\.length\)\.setValues\(block\)/.test(src));

  // ── the shape the eighteen forms already expect ──────────────────────
  const flat = ctx.getTpl();
  eq('the templates come from the library', flat.source, 'library');
  // One record per template now, carrying both lengths: which one is wanted
  // follows from whether the text is being saved or printed, not from a
  // second choice at the chair. which-length-goes-where.test.js has the rest.
  eq('one record per template', flat.templates.length, 3);
  eq('named for the procedure, with no length in the name',
     flat.templates.map(t => t.situation),
     ['Access Opening', 'Working Length', 'Flap Surgery']);
  eq('and what the forms insert is the full record',
     [flat.templates[0].category, flat.templates[0].text],
     ['RCT', 'Access opening done wrt {tooth} under {anaesthesia}.']);
  eq('with the concise one alongside for the printed sheet',
     flat.templates[0].concise, 'Access opening done wrt {tooth}.');
  eq('the department rides along, because the forms filter on it',
     [...new Set(flat.templates.map(t => t.category))].sort(), ['Periodontics', 'RCT']);
  // The plan is NOT what the forms are fed: it carries no note text.
  ok('the forms are fed the library, not the plan',
     /function clinicalTemplatesFlat_[\s\S]{0,400}getClinicalNoteTemplatesV3_\(\)/.test(src));

  ctx.saveLib({ rows: JSON.stringify([]) });
  eq('with the library emptied it falls back rather than leaving forms blank',
     ctx.getTpl().source, undefined);
  eq('rubbish is refused by both', [ctx.saveLib({ rows: 'x' }).success,
                                    ctx.savePlan({ rows: 'x' }).success], [false, false]);

  ok('all four actions are routed',
     /case "getClinicalNotePlan":/.test(gs) && /case "saveClinicalNotePlan":/.test(gs) &&
     /case "getClinicalNoteTemplateLib":/.test(gs) && /case "saveClinicalNoteTemplateLib":/.test(gs));
  ok('the backend that does this is there to deploy',
     (/var BACKEND_BUILD = "([^"]+)"/.exec(gs) || [, ''])[1] >= '2026-11-08b',
     (/var BACKEND_BUILD = "([^"]+)"/.exec(gs) || [])[1]);
}

// ── the type suffix must not confuse the prescription matcher ───────────
{
  const ctx = { String, Array, Object };
  vm.createContext(ctx);
  vm.runInContext(html.slice(html.indexOf('const CGHS_TPL_STOP = ['),
                             html.indexOf('function CghsPrescription('))
    + '\nthis.pick = cghsTemplateFor;', ctx);
  const T = [
    { situation: 'Scaling · Type 1 (Concise)', text: 'Scaling done.' },
    { situation: 'Scaling · Type 2 (Comprehensive)', text: 'Full mouth scaling and polishing done.' },
    { situation: 'Flap Surgery · Type 1 (Concise)', text: 'Flap raised.' }
  ];
  eq('the type is ignored when matching',
     (ctx.pick('Scaling', T) || {}).situation, 'Scaling · Type 1 (Concise)');
  eq('a rate-card name still finds its treatment',
     (ctx.pick('Flap Surgery- Per Tooth', T) || {}).situation, 'Flap Surgery · Type 1 (Concise)');
  eq('and the concise one wins the tie, which is what goes under a printed line',
     (ctx.pick('Scaling', T) || {}).text, 'Scaling done.');
  eq('something with no template still matches nothing', ctx.pick('Orthodontic Retainer', T), null);
}

// ── the two screens ─────────────────────────────────────────────────────
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String((e && e.message) || e)));
  await page.setContent('<body style="margin:0;padding:16px;font-family:system-ui"><div id="root"></div></body>');
  for (const f of ['node_modules/react/umd/react.production.min.js',
                   'node_modules/react-dom/umd/react-dom.production.min.js'])
    await page.addScriptTag({ content: fs.readFileSync(path.join(REPO, f), 'utf8') });
  await page.addScriptTag({ content: `
    const T="#0078B4", BORDER="#e5e5e0", BGS="#f5f5f0";
    const inp={padding:"6px 10px",fontSize:14,border:"1px solid #e5e5e0",borderRadius:6,
               background:"#fff",color:"#1a1a1a",boxSizing:"border-box",fontFamily:"inherit"};
    const CLINICAL_TEMPLATE_CATEGORIES = ${JSON.stringify(CATS)};
    // The editors share Master's own small pieces: the uppercase label and
    // the textarea style every list on that page already uses.
    const TL = "#DCF4FB";
    const ta = { ...inp, resize:"vertical", minHeight:52 };
    const Lbl = ({ c }) => React.createElement("div", { style:{ fontSize:10, fontWeight:700,
      color:"#2e2e2e", textTransform:"uppercase", letterSpacing:"0.04em", marginBottom:3 } }, c);
    window.__saved = null;
    window.confirm = () => true;
  ` });
  await page.addScriptTag({ content:
    html.slice(html.indexOf('const CLINICAL_PLAN_NAMES = ['),
               html.indexOf('const CLINICAL_TEMPLATE_CATEGORIES = [')) });

  const LIB = [
    { category: 'RCT', template: 'Access Opening', type1: 'Access opening done wrt {tooth}.',
      type2: 'Access opening done wrt {tooth} under {anaesthesia}.' },
    { category: 'RCT', template: 'Working Length', type1: 'WL recorded wrt {tooth}.',
      type2: 'Working length recorded wrt {tooth} using {method}.' },
    { category: 'Periodontics', template: 'Flap Surgery', type1: 'Flap raised wrt {tooth}.',
      type2: 'Flap raised wrt {tooth} under {anaesthesia}.' }
  ];
  const ROWS = [
    { plan: 'Normal', treatment: 'RCT - Access Open', category: 'RCT',
      templates: 'Access Opening → Working Length' },
    { plan: 'Normal', treatment: 'Consultation', category: 'General / Consultation',
      templates: 'Nothing By That Name' },
    { plan: 'CGHS', treatment: 'Flap Surgery- Per Tooth', category: 'Periodontics',
      templates: 'Flap Surgery' }
  ];

  const mount = async (component, props) => {
    await page.evaluate(({ component, props }) => {
      window.__saved = null;
      const root = document.getElementById('root');
      ReactDOM.render(null, root);
      ReactDOM.render(React.createElement(window[component] || eval(component), {
        key: String(Math.random()), ...props, saving: false,
        onSave: (next) => { window.__saved = next; }
      }), root);
    }, { component, props });
    await page.waitForTimeout(110);
  };
  const text = () => page.$eval('#root', el => el.innerText.replace(/\s+/g, ' ').trim());
  const saved = () => page.evaluate(() => window.__saved);
  const button = (re) => page.evaluateHandle((src) => {
    const rx = new RegExp(src, 'i');
    return [...document.querySelectorAll('button')].find(b => rx.test(b.innerText)) || null;
  }, re);

  // ── the pattern the clinic asked for back ─────────────────────────────
  // "the earlier pattern was much better which showed the categories and
  //  under that the matter ... add edit and remove / delete button for each"
  //
  // So: a form at the top that doubles as the editor, and cards grouped
  // under a department heading, each with Edit and Remove on it. A row you
  // have to discover is clickable is not a button.
  const names = () => page.$$eval('span', els =>
    els.filter(e => e.style && e.style.fontSize === '14px' && e.style.fontWeight === '700')
       .map(e => e.textContent.trim()));
  const headings = () => page.$$eval('div', els =>
    els.filter(e => e.style && e.style.textTransform === 'uppercase'
                 && e.style.fontSize === '12px' && e.style.letterSpacing === '0.04em')
       .map(e => e.textContent.trim()));
  const rowBtns = (label) => page.$$eval('button', (els, label) =>
    els.filter(e => e.textContent.trim() === label).length, label);

  // ── the template library ──────────────────────────────────────────────
  await mount('ClinicalTemplateLibEditor', { rows: [], seed: TPL.slice(0, 12) });
  let t = await text();
  ok('an empty library offers the clinic\'s templates',
     /No clinical note templates yet/.test(t) && /Load the clinic's templates \(12\)/.test(t), t);
  await (await button("Load the clinic's templates")).asElement().click();
  await page.waitForTimeout(110);
  let out = await saved();
  eq('loaded as rows, not arrays', Object.keys(out[0]).sort(),
     ['category', 'template', 'type1', 'type2']);
  eq('all of them', out.length, 12);

  await mount('ClinicalTemplateLibEditor', { rows: LIB, seed: TPL });
  t = await text();
  ok('it says how many, and in how many departments',
     /3 templates in 2 departments\./.test(t), t);
  eq('the departments are headings, with their counts',
     await headings(), ['Periodontics  ·  1', 'RCT  ·  2']);
  eq('and the templates sit under them', await names(),
     ['Flap Surgery', 'Access Opening', 'Working Length']);
  ok('both lengths are on the card, labelled',
     /TYPE 1 Access opening done wrt \{tooth\}\. TYPE 2 Access opening done wrt \{tooth\} under \{anaesthesia\}\./.test(t), t);
  eq('every row has an Edit', await rowBtns('Edit'), 3);
  eq('and a Remove', await rowBtns('Remove'), 3);

  // Edit puts the row in the form at the top, and says which row it is.
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('span')]
      .find(sp => sp.textContent.trim() === 'Working Length').parentElement;
    [...row.querySelectorAll('button')].find(b => b.textContent.trim() === 'Edit').click();
  });
  await page.waitForTimeout(110);
  // In the ROW, not in the form at the top. It used to load the row into
  // that form and scroll there, which with 156 templates jumps the page ten
  // thousand pixels away from what you pressed -- reported, fairly, as the
  // button not working.
  {
    const card = await page.evaluate(() => {
      const sp = [...document.querySelectorAll('span')]
        .find(s => s.textContent.trim() === 'Working Length');
      const box = sp.closest('div[style*="border-radius"]');
      return { areas: [...box.querySelectorAll('textarea')].map(a => a.value),
               inputs: [...box.querySelectorAll('input')].map(i => i.value) };
    });
    eq('the row itself opens with both lengths in it', card.areas,
       ['WL recorded wrt {tooth}.', 'Working length recorded wrt {tooth} using {method}.']);
    eq('and the template name in the row', card.inputs, ['Working Length']);
  }
  // Two states, not one: sharing them meant pressing Edit quietly refilled
  // the add form with the row being edited.
  eq('the add form at the top is left alone',
     await page.$eval('input[placeholder*="Access Opening"]', e => e.value), '');
  await page.evaluate(() => {
    const sp = [...document.querySelectorAll('span')]
      .find(s => s.textContent.trim() === 'Working Length');
    const a = sp.closest('div[style*="border-radius"]').querySelectorAll('textarea')[1];
    const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    set.call(a, 'Rewritten full record.');
    a.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(80);
  await (await button('^Save$')).asElement().click();
  await page.waitForTimeout(110);
  out = await saved();
  eq('the edit lands on the row it was opened from',
     out.map(r => r.type2),
     ['Access opening done wrt {tooth} under {anaesthesia}.', 'Rewritten full record.',
      'Flap raised wrt {tooth} under {anaesthesia}.']);
  eq('and nothing else about it moved', out[1].template, 'Working Length');

  // Adding, through the same form.
  await mount('ClinicalTemplateLibEditor', { rows: LIB, seed: TPL });
  await page.locator('input[placeholder*="Access Opening"]').fill('Pulp Capping');
  await page.locator('textarea').first().fill('Pulp capping done wrt {tooth}.');
  await (await button('Add Template')).asElement().click();
  await page.waitForTimeout(110);
  out = await saved();
  eq('a new template is appended', out.length, 4);
  eq('with what was typed', [out[3].template, out[3].type1],
     ['Pulp Capping', 'Pulp capping done wrt {tooth}.']);

  // Removing, with a question first.
  await mount('ClinicalTemplateLibEditor', { rows: LIB, seed: TPL });
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('span')]
      .find(sp => sp.textContent.trim() === 'Flap Surgery').parentElement;
    [...row.querySelectorAll('button')].find(b => b.textContent.trim() === 'Remove').click();
  });
  await page.waitForTimeout(110);
  out = await saved();
  eq('Remove takes out that one and leaves the rest',
     out.map(r => r.template), ['Access Opening', 'Working Length']);

  // ── the plan, and Plan CGHS ───────────────────────────────────────────
  await mount('ClinicalPlanEditor', { plan: 'Normal', rows: [], templates: LIB, seed: PLAN.slice(0, 9) });
  t = await text();
  ok('an empty plan offers the clinic\'s plans',
     /Nothing on the plan yet/.test(t) && /Load the clinic's plans \(9 treatments\)/.test(t), t);

  await mount('ClinicalPlanEditor', { plan: 'Normal', rows: ROWS, templates: LIB, seed: PLAN });
  t = await text();
  eq('the normal plan shows only its own treatments', await names(),
     ['Consultation', 'RCT - Access Open']);
  eq('grouped by department, as the templates are', await headings(),
     ['General / Consultation  ·  1', 'RCT  ·  1']);
  eq('every treatment has an Edit', await rowBtns('Edit'), 2);
  eq('and a Remove', await rowBtns('Remove'), 2);
  // "we just need only headings." The normal plan is a list of treatments;
  // the notes have a screen of their own, and repeating them here was noise.
  ok('the normal plan shows no note text',
     !/Access opening done wrt \{tooth\}\./.test(t)
     && !/WL recorded wrt \{tooth\}\./.test(t), t);
  ok('nor the template names it points at',
     !/Access Opening/.test(t) && !/Nothing By That Name/.test(t), t);
  ok('and it says where the notes live instead',
     /The notes live under Clinical Note Templates\./.test(t), t);

  // The CGHS plan is the same component with the other plan, which is what
  // makes it a tab rather than a filter.
  await mount('ClinicalPlanEditor', { plan: 'CGHS', rows: ROWS, templates: LIB, seed: PLAN });
  t = await text();
  eq('Plan CGHS shows its own treatments, and only those', await names(),
     ['Flap Surgery- Per Tooth']);
  ok('named as Plan CGHS on the screen', /on Plan CGHS\./.test(t), t);
  // Kept HERE, and only here: a CGHS prescription is written from these
  // notes, so what each treatment produces is part of the job on this tab.
  ok('the note each treatment writes is shown', /Flap raised wrt \{tooth\}\./.test(t), t);
  ok('with the template it comes from', /Flap Surgery/.test(t), t);
  ok('and the screen says what the note is for',
     /what a CGHS prescription is written from/.test(t), t);

  // The unresolved name must still be called out -- on the tab where the
  // notes matter, a treatment that writes nothing is a prescription that
  // comes up blank.
  await mount('ClinicalPlanEditor', { plan: 'CGHS', templates: LIB, seed: PLAN,
    rows: ROWS.concat([{ plan: 'CGHS', treatment: 'Scaling - CGHS',
                         category: 'Periodontics', templates: 'Nothing By That Name' }]) });
  ok('a template name that matches nothing is called out on Plan CGHS',
     /No template of that name in the library\./.test(await text()), await text());

  await mount('ClinicalPlanEditor', { plan: 'CGHS', rows: ROWS, templates: LIB, seed: PLAN });
  t = await text();

  // An edit on one plan must not touch the other: both live in one store.
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('span')]
      .find(sp => sp.textContent.trim() === 'Flap Surgery- Per Tooth').parentElement;
    [...row.querySelectorAll('button')].find(b => b.textContent.trim() === 'Edit').click();
  });
  await page.waitForTimeout(110);
  {
    const card = await page.evaluate(() => {
      const sp = [...document.querySelectorAll('span')]
        .find(s => s.textContent.trim() === 'Flap Surgery- Per Tooth');
      const box = sp.closest('div[style*="border-radius"]');
      return { inputs: [...box.querySelectorAll('input')].map(i => i.value),
               areas: box.querySelectorAll('textarea').length };
    });
    eq('a plan row opens in place, with its own fields', card.inputs,
       ['Flap Surgery- Per Tooth', 'Flap Surgery', '']);
    eq('and no note boxes, because the notes are not kept here', card.areas, 0);
  }
  await (await button('^Save$')).asElement().click();
  await page.waitForTimeout(110);
  out = await saved();
  eq('the whole store comes back, both plans in it', out.length, 3);
  eq('with each row still on its own plan', out.map(r => r.plan),
     ['Normal', 'Normal', 'CGHS']);

  // A treatment added on Plan CGHS lands on Plan CGHS.
  await mount('ClinicalPlanEditor', { plan: 'CGHS', rows: ROWS, templates: LIB, seed: PLAN });
  await page.locator('input[placeholder*="RCT - Access Open"]').fill('Scaling - Full Mouth');
  await (await button('Add Treatment')).asElement().click();
  await page.waitForTimeout(110);
  out = await saved();
  eq('appended to the store', out.length, 4);
  eq('on the CGHS plan, not the normal one',
     [out[3].treatment, out[3].plan], ['Scaling - Full Mouth', 'CGHS']);

  await mount('ClinicalPlanEditor', { plan: 'Normal', rows: ROWS, templates: LIB, seed: PLAN });
  // By its placeholder, not its position: the form above it owns the first
  // two inputs, and counting them is how this broke.
  await page.locator('input[placeholder*="department or template"]').fill('access');
  await page.waitForTimeout(110);
  t = await text();
  ok('search narrows the plan', /1 of 2 shown/.test(t), t);
  eq('to the one treatment that matches', await names(), ['RCT - Access Open']);

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
