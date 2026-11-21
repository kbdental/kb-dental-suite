// "in Procedure done sheet I need a date option so that if some one does
//  not bring there file and the treatment done is not entered we can do
//  that by date search or tooth search we need that option"
//
// A patient turns up without their folder and says the root canal was
// "some time in May, on a lower back tooth". Eighty-four visits down a
// page is not a way to answer that.
//
// A date range and a tooth, over the rows AFTER they are split per tooth
// -- so a visit that covered 37 and 47 answers a search for 47 with the
// line about 47, not with the whole visit and the other tooth's work.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');

const checks = [];
const ok = (name, cond, detail) => checks.push({ name, ok: !!cond, got: detail });
const eq = (name, got, want) => checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });

ok('the filter is its own control, not inlined into the sheet',
   /function KbRecordFilter\(/.test(html));
ok('it filters the rows AFTER they are split per tooth',
   /const all = kbSplitVisitRows\(entries, \["clinicalNotes", "workDone"\]\);/.test(html));
// "36" must not match "36, 37" by being a substring of it, nor miss it.
ok('a tooth cell is read as the list it is, not as text',
   /\.split\(\/\[\^0-9A-Z\]\+\/\)\.filter\(Boolean\);\s*\n\s*return teeth\.indexOf\(want\) >= 0;/.test(html));
ok('and printing prints what the filter left',
   (html.match(/buildProcedureDoneHTML\(pat, procedureRows\)/g) || []).length === 3);

const LOCAL = {
  'react/18.2.0/umd/react.production.min.js': 'node_modules/react/umd/react.production.min.js',
  'react-dom/18.2.0/umd/react-dom.production.min.js': 'node_modules/react-dom/umd/react-dom.production.min.js'
};
// One visit covers two teeth, so it splits; the rest are one each.
const ENTRIES = [
  { date: '2024-05-01', toothNo: '37, 47', doctor: 'Dr. Manika Mittel', treatmentRendered: 'Restoration',
    clinicalNotes: 'Cervical caries excavated wrt 37.\nAdvised FMA with implant wrt 47.', workDone: '' },
  { date: '2024-05-06', toothNo: '42', doctor: 'Dr. Manika Mittel', treatmentRendered: 'RCT',
    clinicalNotes: 'Obturation done wrt 42.', workDone: '' },
  { date: '2024-07-16', toothNo: '36', doctor: 'Dr. Manika Mittel', treatmentRendered: 'RCT',
    clinicalNotes: 'RC opened 3 canals wrt 36.', workDone: '' },
  { date: '2024-10-16', toothNo: '47', doctor: 'Dr. Viveyk Mittel', treatmentRendered: 'Extraction',
    clinicalNotes: 'Surgical extraction wrt 47.', workDone: '' }
];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String((e && e.message) || e)));
  await page.route('**cdnjs.cloudflare.com/**', r => {
    const u = r.request().url();
    const h = Object.keys(LOCAL).find(k => u.indexOf(k) >= 0);
    return r.fulfill({ status: 200, contentType: 'application/javascript',
      body: h ? fs.readFileSync(path.join(REPO, LOCAL[h]), 'utf8') : '/* */' });
  });
  await page.route('**script.google.com/**', r => {
    const body = r.request().postData() || r.request().url();
    let out = { success: true };
    if (/getTreatmentProgress/.test(body)) out = { success: true, entries: ENTRIES };
    if (/getSignatures/.test(body)) out = { success: true, signatures: {} };
    if (/[Rr]eceipt/.test(body)) out = { success: true, receipts: [] };
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(out) });
  });
  await page.goto('file://' + path.join(REPO, 'index.html'));
  await page.waitForTimeout(2300);
  await page.evaluate(() => ReactDOM.render(React.createElement(TreatmentProgress, {
    globalPat: { uhid: 'AH0507', name: 'Kamal Chawla', dob: '05/07/1965' },
    setGlobalPat: () => {}, initialTab: 'procedure'
  }), document.getElementById('root')));
  await page.waitForTimeout(2200);

  // Read the table itself, not the whole page -- the patient's date of
  // birth is in the header and looks exactly like a visit date.
  const rows = () => page.evaluate(() => {
    const hd = [...document.querySelectorAll('div')].find(d =>
      d.style.display === 'grid' && /S\.No\./.test(d.textContent) && /Tooth/.test(d.textContent));
    if (!hd) return [];
    const out = [];
    let el = hd.nextElementSibling;
    while (el && el.style.display === 'grid') {
      const c = [...el.children].map(x => x.textContent.trim());
      out.push({ date: c[1], tooth: c[2], note: c[3] });
      el = el.nextElementSibling;
    }
    return out;
  });
  const set = (which, v) => page.evaluate(([w, val]) => {
    const all = [...document.querySelectorAll('input')];
    const el = w === 'tooth' ? all.find(x => x.placeholder === 'e.g. 36')
             : all.filter(x => x.type === 'date')[w === 'from' ? 0 : 1];
    const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    s.call(el, val); el.dispatchEvent(new Event('input', { bubbles: true }));
  }, [which, v]);

  {
    const r = await rows();
    eq('every line to begin with, the two-tooth visit split in two', r.length, 5);
    eq('and in the order they were recorded',
       r.map(x => x.tooth), ['37', '47', '42', '36', '47']);
  }

  // ── by tooth ─────────────────────────────────────────────────────────
  await set('tooth', '47'); await page.waitForTimeout(400);
  {
    const r = await rows();
    eq('a tooth search finds every line for it', r.length, 2);
    eq('from both the visit it shared and the one it did not',
       r.map(x => x.date), ['01/05/2024', '16/10/2024']);
    // The point of filtering split rows: the other tooth's work does not
    // come along for the ride.
    ok('and not the other tooth\'s work from the same visit',
       r.every(x => x.note.indexOf('Cervical caries') < 0), JSON.stringify(r));
  }
  // 4 must not match 47, nor 7 match it either.
  await set('tooth', '4'); await page.waitForTimeout(400);
  eq('a partial number matches nothing', (await rows()).length, 0);
  await set('tooth', '7'); await page.waitForTimeout(400);
  eq('nor the other half of one', (await rows()).length, 0);

  // ── by date ──────────────────────────────────────────────────────────
  await set('tooth', '');
  await set('from', '2024-07-01'); await set('to', '2024-12-31');
  await page.waitForTimeout(400);
  {
    const r = await rows();
    eq('a date range finds the visits inside it', r.map(x => x.date),
       ['16/07/2024', '16/10/2024']);
  }
  // Both ends count.
  await set('from', '2024-05-06'); await set('to', '2024-05-06');
  await page.waitForTimeout(400);
  eq('a single day is both ends of its own range', (await rows()).map(x => x.tooth), ['42']);

  // ── both together ────────────────────────────────────────────────────
  await set('from', '2024-07-01'); await set('to', '2024-12-31');
  await set('tooth', '47'); await page.waitForTimeout(400);
  {
    const r = await rows();
    eq('a date AND a tooth narrow together', r.length, 1);
    eq('to the one line that answers both', [r[0].date, r[0].tooth], ['16/10/2024', '47']);
  }
  // Nothing found says which knob to turn.
  await set('tooth', '11'); await page.waitForTimeout(400);
  {
    eq('nothing matching shows no rows', (await rows()).length, 0);
    const t = await page.evaluate(() => document.body.innerText);
    ok('and says how to widen it', /Widen the dates, or clear the tooth/.test(t), t.slice(0, 200));
  }

  // ── and it can be put down again ─────────────────────────────────────
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Clear');
    if (b) b.click();
  });
  await page.waitForTimeout(400);
  eq('Clear gives the whole record back', (await rows()).length, 5);

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
})();
