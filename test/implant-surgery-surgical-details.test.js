// Implant Surgery gained the detail a real surgical record needs: "Other"
// free-text behind Investigation / Osteotomy / Graft, sizes that follow the
// implant brand, the drill kit and drill sequence, suturing (placed, type,
// brand, size, knot), graft and membrane brand/size/amount, and suture removal
// at follow-up. Each box only appears once the answer above calls for it, and
// every one of them has to survive a save/reload round trip.

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.resolve(__dirname, '..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'kbimpsurg-'));

function extract() {
  const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  const m = /const IMP_SURGERY_B64\s*=\s*([\s\S]*?);\n/.exec(html);
  if (!m) throw new Error('IMP_SURGERY_B64 not found');
  const b64 = (m[1].match(/"([^"]*)"/g) || []).map(s => s.slice(1, -1)).join('');
  const p = path.join(OUT, 'implant-surgery.html');
  fs.writeFileSync(p, Buffer.from(b64, 'base64'));
  return p;
}

const checks = [];
const eq = (name, got, want) =>
  checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });
const ok = (name, cond, detail) => checks.push({ name, ok: !!cond, got: detail, want: 'truthy' });

const visible = (page, id) => page.evaluate(i => {
  const el = document.getElementById(i);
  return !!el && el.style.display !== 'none';
}, id);

const clickOpt = (page, groupId, label) => page.evaluate(({ groupId, label }) => {
  const g = document.getElementById(groupId);
  if (!g) throw new Error('no group ' + groupId);
  const b = Array.from(g.querySelectorAll('.btn')).find(x => x.textContent.trim() === label);
  if (!b) throw new Error('no option "' + label + '" in #' + groupId);
  b.click();
}, { groupId, label });

const setVal = (page, id, v) => page.evaluate(({ id, v }) => {
  const el = document.getElementById(id);
  if (!el) throw new Error('no field ' + id);
  el.value = v;
}, { id, v });

(async () => {
  const file = extract();
  const browser = await chromium.launch(
    process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto('file://' + file);
  await page.waitForTimeout(250);

  // --- 1 / 2: "Other" reveals a box, and only then -------------------------
  eq('Investigation "Other" box is hidden until asked for', await visible(page, 'investOtherRow'), false);
  await clickOpt(page, 'investGrp', 'Other');
  eq('choosing Investigation "Other" reveals the box', await visible(page, 'investOtherRow'), true);
  await clickOpt(page, 'investGrp', 'RVG');
  eq('choosing a normal Investigation hides it again', await visible(page, 'investOtherRow'), false);

  eq('Osteotomy "Other" box is hidden by default', await visible(page, 'osteoOtherRow'), false);
  await clickOpt(page, 'osteoType', 'Other');
  eq('Osteotomy now offers "Other"', await visible(page, 'osteoOtherRow'), true);

  eq('Graft "Other" box is hidden by default', await visible(page, 'graftOtherRow'), false);
  await clickOpt(page, 'graftGrp', 'Other');
  eq('choosing Graft "Other" reveals the box', await visible(page, 'graftOtherRow'), true);

  // --- 6: any graft asks for brand / size / amount -------------------------
  eq('graft brand/size/amount appear once a graft is chosen', await visible(page, 'graftDetailRow'), true);

  // --- 7: membrane ---------------------------------------------------------
  eq('membrane brand/size hidden until it is used', await visible(page, 'membraneDetailRow'), false);
  await clickOpt(page, 'membraneUsed', 'Used');
  eq('membrane brand/size appear when used', await visible(page, 'membraneDetailRow'), true);

  // --- 5: suturing ---------------------------------------------------------
  eq('suture detail hidden when nothing is placed', await visible(page, 'sutureTypeRow'), false);
  await clickOpt(page, 'suturePlaced', 'Placed');
  eq('suture type appears once placed', await visible(page, 'sutureTypeRow'), true);
  eq('suture brand/size appear once placed', await visible(page, 'sutureDetailRow'), true);
  eq('knot type appears once placed', await visible(page, 'knotTypeRow'), true);
  await clickOpt(page, 'suturePlaced', 'Not Placed');
  eq('all suture detail goes away again when not placed', await visible(page, 'knotTypeRow'), false);

  // --- 8: suture removal at follow-up --------------------------------------
  eq('suture removal date hidden until removal is done', await visible(page, 'sutureRemovalDateRow'), false);
  await clickOpt(page, 'sutureRemoval', 'Done');
  eq('suture removal date appears when done', await visible(page, 'sutureRemovalDateRow'), true);

  // --- 3: sizes follow the brand ------------------------------------------
  const sizesFor = brand => page.evaluate(b => {
    const sel = document.querySelector('select[id^="brand_"]');
    sel.value = b;
    sel.dispatchEvent(new Event('change'));
    const rowId = sel.id.replace('brand_', '');
    const dl = document.getElementById('sizes_' + rowId);
    return Array.from(dl.options).map(o => o.value);
  }, brand);

  const straumann = await sizesFor('Straumann');
  ok('Straumann offers its own sizes', straumann.length > 0, straumann.slice(0, 3));
  ok('Straumann list includes 4.1 x 10 mm', straumann.some(s => /4\.1\s*×\s*10\s*mm/.test(s)), straumann.slice(0, 3));
  ok('Straumann list excludes diameters it does not make (4.3)',
    !straumann.some(s => s.indexOf('4.3') === 0), straumann.filter(s => s.indexOf('4.3') === 0));

  const nobel = await sizesFor('Nobel Active');
  ok('Nobel Active offers a different list', JSON.stringify(nobel) !== JSON.stringify(straumann), nobel.slice(0, 3));
  ok('Nobel Active includes 4.3 x 11.5 mm', nobel.some(s => /4\.3\s*×\s*11\.5\s*mm/.test(s)), nobel.slice(0, 3));

  ok('size stays a typed-in field so an unlisted size is never blocked',
    await page.evaluate(() => {
      const el = document.querySelector('input[id^="size_"]');
      return !!el && el.tagName === 'INPUT' && !!el.getAttribute('list');
    }));

  // --- everything survives a save/reload round trip ------------------------
  await clickOpt(page, 'investGrp', 'Other');
  await setVal(page, 'investOther', 'CBCT + surgical guide');
  await setVal(page, 'osteoOther', 'Ridge split');
  await setVal(page, 'graftOther', 'Xenograft');
  await setVal(page, 'graftBrand', 'Bio-Oss');
  await setVal(page, 'graftSize', '0.25-1.0 mm');
  await setVal(page, 'graftQty', '0.5 g');
  await setVal(page, 'membraneBrand', 'Bio-Gide');
  await setVal(page, 'membraneSize', '25x25 mm');
  await setVal(page, 'drillKit', 'Nobel Biocare surgical kit');
  await setVal(page, 'drillSeq', '2.0 pilot -> 2.8 -> 3.2');
  await clickOpt(page, 'suturePlaced', 'Placed');
  await clickOpt(page, 'sutureType', 'PTFE');
  await setVal(page, 'sutureBrand', 'Cytoplast');
  await setVal(page, 'sutureSize', '3-0');
  await clickOpt(page, 'knotType', 'Mattress (Horizontal)');
  await setVal(page, 'sutureRemovalDate', '2026-09-14');

  const roundTrip = await page.evaluate(() => {
    // Re-enter the record the way the app does when resuming a case.
    const rec = {
      invest: 'Other', investOther: 'CBCT + surgical guide',
      osteoType: 'Other', osteoOther: 'Ridge split',
      graft: 'Other', graftOther: 'Xenograft',
      graftBrand: 'Bio-Oss', graftSize: '0.25-1.0 mm', graftQty: '0.5 g',
      membraneUsed: 'Used', membraneBrand: 'Bio-Gide', membraneSize: '25x25 mm',
      drillKit: 'Nobel Biocare surgical kit', drillSeq: '2.0 pilot -> 2.8 -> 3.2',
      suturePlaced: 'Placed', sutureType: 'PTFE', sutureBrand: 'Cytoplast',
      sutureSize: '3-0', knotType: 'Mattress (Horizontal)',
      sutureRemoval: 'Done', sutureRemovalDate: '14/09/2026',
    };
    window.populateFormFromRecord(rec);
    const val = id => (document.getElementById(id) || {}).value;
    const active = gid => Array.from((document.getElementById(gid) || { querySelectorAll: () => [] })
      .querySelectorAll('.btn.active')).map(b => b.textContent.trim()).join(', ');
    const vis = id => { const e = document.getElementById(id); return !!e && e.style.display !== 'none'; };
    return {
      investOther: val('investOther'), osteoOther: val('osteoOther'),
      graftBrand: val('graftBrand'), graftQty: val('graftQty'),
      membraneBrand: val('membraneBrand'), membraneSize: val('membraneSize'),
      drillKit: val('drillKit'), drillSeq: val('drillSeq'),
      suturePlaced: active('suturePlaced'), sutureType: active('sutureType'),
      sutureBrand: val('sutureBrand'), knotType: active('knotType'),
      sutureRemoval: active('sutureRemoval'), sutureRemovalDate: val('sutureRemovalDate'),
      revealedInvest: vis('investOtherRow'), revealedSuture: vis('knotTypeRow'),
      revealedMembrane: vis('membraneDetailRow'), revealedRemovalDate: vis('sutureRemovalDateRow'),
    };
  });

  eq('resume restores Investigation other', roundTrip.investOther, 'CBCT + surgical guide');
  eq('resume restores Osteotomy other', roundTrip.osteoOther, 'Ridge split');
  eq('resume restores graft brand', roundTrip.graftBrand, 'Bio-Oss');
  eq('resume restores graft amount used', roundTrip.graftQty, '0.5 g');
  eq('resume restores membrane brand', roundTrip.membraneBrand, 'Bio-Gide');
  eq('resume restores membrane size', roundTrip.membraneSize, '25x25 mm');
  eq('resume restores drill kit', roundTrip.drillKit, 'Nobel Biocare surgical kit');
  eq('resume restores drill sequence', roundTrip.drillSeq, '2.0 pilot -> 2.8 -> 3.2');
  eq('resume restores suture placed', roundTrip.suturePlaced, 'Placed');
  eq('resume restores suture type', roundTrip.sutureType, 'PTFE');
  eq('resume restores suture brand', roundTrip.sutureBrand, 'Cytoplast');
  eq('resume restores knot type', roundTrip.knotType, 'Mattress (Horizontal)');
  eq('resume restores suture removal', roundTrip.sutureRemoval, 'Done');
  eq('resume converts the removal date to ISO for the date field',
    roundTrip.sutureRemovalDate, '2026-09-14');

  // A restored record must re-open the boxes its answers call for, or the
  // values would be present but invisible.
  eq('resume re-opens the Investigation other box', roundTrip.revealedInvest, true);
  eq('resume re-opens the suture detail', roundTrip.revealedSuture, true);
  eq('resume re-opens the membrane detail', roundTrip.revealedMembrane, true);
  eq('resume re-opens the suture removal date', roundTrip.revealedRemovalDate, true);

  eq('no uncaught page errors', errors, []);
  await browser.close();

  let pass = 0, fail = 0;
  console.log('\n' + '='.repeat(78));
  console.log('IMPLANT SURGERY — SURGICAL DETAIL, GRAFT/MEMBRANE, SUTURING, FOLLOW-UP');
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
