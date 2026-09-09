// Implant Prosthetic could not record what the impression was actually taken
// with. It had one "Impression" row holding the technique (Digital Scan / Open
// Tray / Closed Tray) and nothing at all for the material, while Crown &
// Bridge asked for the material. And the impression coping's size — which is
// per implant, not per case — had nowhere to go on a single-implant case, let
// alone a multi-implant one.
//
// So: Impression Material, using Crown & Bridge's list; the technique row
// renamed to what it is, Impression Coping Used; and a coping size line per
// implant, appearing as the sites are named — the same shape as the RCT form,
// where naming a canal opens a line to type its length into.

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'kbcoping-'));

function extract(blob, file) {
  const m = new RegExp('const ' + blob + '\\s*=\\s*([\\s\\S]*?);\\n').exec(html);
  if (!m) throw new Error(blob + ' not found');
  const b64 = (m[1].match(/"([^"]*)"/g) || []).map(s => s.slice(1, -1)).join('');
  const text = Buffer.from(b64, 'base64').toString('utf8');
  fs.writeFileSync(path.join(OUT, file), text);
  return text;
}

const checks = [];
const eq = (name, got, want) =>
  checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });
const ok = (name, cond, detail) =>
  checks.push({ name, ok: !!cond, got: detail, want: 'truthy' });

const host = child => {
  const p = path.join(OUT, 'h_' + child);
  fs.writeFileSync(p, `<!DOCTYPE html><html><body>
    <iframe src="${child}" style="width:100%;height:900px;border:0;"></iframe>
    <script>
      window.__posted = null;
      window.addEventListener('message', function(e){
        if (e.data && e.data.type === 'KB_SAVE_CLINICAL_SHEET') {
          window.__posted = e.data;
          e.source.postMessage({ type:'KB_SAVE_RESULT', token:e.data.token, ok:true }, '*');
        }
      });
    </script></body></html>`);
  return p;
};

(async () => {
  const ip = extract('IMP_PROSTHETIC_B64', 'ip.html');
  const cb = extract('CROWN_BRIDGE_B64', 'cb.html');

  // ── the material list is Crown & Bridge's, not a new invention ──────────
  const listOf = (text, id) => {
    const m = new RegExp('id="' + id + '">([\\s\\S]*?)</div>').exec(text);
    return m ? m[1].match(/>([^<]+)<\/button>/g).map(s => s.slice(1, -9)) : null;
  };
  eq('Impression Material offers what Crown & Bridge offers',
    listOf(ip, 'imprMaterial'), listOf(cb, 'finalImp'));
  eq('Impression Coping Used offers Digital / Closed Tray / Open Tray',
    listOf(ip, 'finalImp'), ['Digital', 'Closed Tray', 'Open Tray']);
  eq('the old unqualified "Impression" label is gone',
    /<div class="fl">Impression \*<\/div>/.test(ip), false);

  const browser = await chromium.launch(
    process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const errors = [];
  const page = await browser.newPage();
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto('file://' + host('ip.html'));
  await page.waitForTimeout(900);
  const f = page.frames().find(fr => fr.url().endsWith('/ip.html'));
  // The form starts with one implant row of its own; wait for it rather than
  // guessing at a delay, or the first count races the form's setup.
  await f.waitForFunction(() => document.querySelectorAll('#impTbody tr').length > 0);

  const visible = id => f.evaluate(i => {
    const el = document.getElementById(i);
    return !!el && el.style.display !== 'none';
  }, id);
  const copingLines = () => f.evaluate(() =>
    Array.from(document.querySelectorAll('#copingTbody tr')).map(tr => ({
      site: tr.querySelector('.cbn').textContent.trim(),
      size: tr.querySelector('input').value,
      id: tr.querySelector('input').id,
    })));
  const clickOpt = (groupId, label) => f.evaluate(({ groupId, label }) => {
    const g = document.getElementById(groupId);
    const b = Array.from(g.querySelectorAll('.btn')).find(x => x.textContent.trim() === label);
    if (!b) throw new Error('no option "' + label + '" in #' + groupId);
    b.click();
  }, { groupId, label });
  // The real flow: open the tooth picker on a row, pick a tooth, confirm.
  const pickSite = (rowIndex, tooth) => f.evaluate(({ rowIndex, tooth }) => {
    const btns = document.querySelectorAll('[id^="tbtn_"]');
    btns[rowIndex].click();
    const t = Array.from(document.querySelectorAll('.ft')).find(x => x.dataset.n === String(tooth));
    if (!t) throw new Error('no tooth ' + tooth + ' on the chart');
    t.click();
    document.getElementById('modalConfirm').click();
  }, { rowIndex, tooth });
  const addImplant = () => f.evaluate(() => document.getElementById('addImpBtn').click());

  // ── the size lines follow the implants ─────────────────────────────────
  // There is one coping line per implant, always — that is the invariant that
  // matters, not any particular starting count.
  const implantRows = () => f.evaluate(() => document.querySelectorAll('#impTbody tr').length);
  eq('the form opens with a coping line for the implant row it starts with',
    (await copingLines()).length, await implantRows());
  eq('and the coping size row is on show', await visible('copingSizeRow'), true);
  eq('an unnamed site says so rather than repeating the picker prompt',
    (await copingLines())[0].site, 'site not chosen yet');

  await pickSite(0, 36);
  await page.waitForTimeout(200);
  eq('naming the site names its coping line', (await copingLines())[0].site, 'Tooth 36');

  // Type a size, then add a second implant: the first must not be wiped.
  const firstId = (await copingLines())[0].id;
  await f.evaluate(id => { document.getElementById(id).value = '4.1 mm regular'; }, firstId);
  await addImplant();
  await page.waitForTimeout(200);
  await pickSite(1, 46);
  await page.waitForTimeout(200);

  let lines = await copingLines();
  eq('a second implant gets its own line', lines.length, await implantRows());
  eq('the first size survives adding another implant', lines[0].size, '4.1 mm regular');
  eq('and the sites read in order', lines.map(l => l.site), ['Tooth 36', 'Tooth 46']);

  await f.evaluate(id => { document.getElementById(id).value = '3.5 mm narrow'; }, lines[1].id);

  // ── it all reaches the record ──────────────────────────────────────────
  await clickOpt('imprMaterial', 'Vinyl Poly-siloxane (Putty)');
  await clickOpt('finalImp', 'Open Tray');
  await f.evaluate(() => {
    document.getElementById('pId').value = 'AL0777';
    document.getElementById('pName').value = 'Test Patient';
  });
  await f.evaluate(() => document.getElementById('saveBtn').click());
  await page.waitForTimeout(500);
  const posted = await page.evaluate(() => window.__posted);
  const rec = posted && posted.allTeeth;
  ok('the record was posted', !!rec, posted && posted.type);
  eq('the impression material is saved', rec && rec.imprMaterial, 'Vinyl Poly-siloxane (Putty)');
  eq('the coping technique is saved', rec && rec.finalImp, 'Open Tray');
  eq('each implant carries its own coping size',
    (rec && rec.implants || []).map(i => [i.site, i.coping]),
    [['36', '4.1 mm regular'], ['46', '3.5 mm narrow']]);
  eq('and there is one saved implant per coping line',
    (rec && rec.implants || []).length, lines.length);

  // ── the printed record shows both, and the size per implant ────────────
  const summary = await f.evaluate(() => {
    // This form has five tabs; the record sheet is the last one.
    const tab = document.querySelector('.tab[data-tab="5"]');
    if (!tab) throw new Error('no summary tab');
    tab.click();
    return document.getElementById('summaryContent').innerText;
  });
  ok('the printed record names the impression material',
    /Vinyl Poly-siloxane/.test(summary), null);
  // The record sheet uppercases its labels in CSS, and innerText reflects
  // that, so match the wording rather than the casing.
  ok('and the coping used', /impression coping used/i.test(summary),
    (summary.match(/.{0,10}coping.{0,20}/i) || [''])[0]);
  ok('and carries a Coping Size column', /coping size/i.test(summary),
    (summary.match(/.{0,10}coping size.{0,20}/i) || [''])[0]);
  ok('with each size in it', /4\.1 mm regular/.test(summary) && /3\.5 mm narrow/.test(summary), null);
  await page.close();

  // ── resume ─────────────────────────────────────────────────────────────
  const resumed = async record => {
    const p2 = await browser.newPage();
    p2.on('pageerror', e => errors.push('resume: ' + e.message));
    await p2.goto('file://' + host('ip.html'));
    await p2.waitForTimeout(900);
    const f2 = p2.frames().find(fr => fr.url().endsWith('/ip.html'));
    await f2.evaluate(r => window.postMessage({ type: 'KB_CLINICAL_RECORD', record: r }, '*'), record);
    await p2.waitForTimeout(400);
    const out = await f2.evaluate(() => ({
      coping: Array.from(document.querySelectorAll('#copingTbody tr')).map(tr => ({
        site: tr.querySelector('.cbn').textContent.trim(),
        size: tr.querySelector('input').value,
      })),
      material: Array.from(document.getElementById('imprMaterial').querySelectorAll('.btn.active')).map(b => b.textContent.trim()),
      technique: Array.from(document.getElementById('finalImp').querySelectorAll('.btn.active')).map(b => b.textContent.trim()),
    }));
    await p2.close();
    return out;
  };

  const back = await resumed({
    pName: 'Test Patient', pId: 'AL0777',
    imprMaterial: 'Alginate', finalImp: 'Closed Tray',
    implants: [{ n: 1, site: '36', date: '01/09/2026', coping: '4.1 mm regular' },
               { n: 2, site: '46', date: '01/09/2026', coping: '3.5 mm narrow' }],
  });
  eq('a reopened record brings back each coping size against its site',
    back.coping, [{ site: 'Tooth 36', size: '4.1 mm regular' }, { site: 'Tooth 46', size: '3.5 mm narrow' }]);
  eq('and the impression material', back.material, ['Alginate']);
  eq('and the coping technique', back.technique, ['Closed Tray']);

  // A record from before the rename stored the technique as "Digital Scan".
  const old = await resumed({
    pName: 'X', pId: 'AL0777', finalImp: 'Digital Scan',
    implants: [{ n: 1, site: '36' }],
  });
  eq('an older "Digital Scan" technique comes back as Digital', old.technique, ['Digital']);
  eq('a record with no coping size on file leaves the box empty, not "—"',
    old.coping.map(c => c.size), ['']);

  eq('no uncaught page errors', errors, []);
  await browser.close();

  let pass = 0, fail = 0;
  console.log('\n' + '='.repeat(78));
  console.log('IMPLANT PROSTHETIC — IMPRESSION MATERIAL, COPING USED, COPING SIZE PER IMPLANT');
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
})();
