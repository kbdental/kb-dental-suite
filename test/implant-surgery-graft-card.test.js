// The graft, osteotomy-specify and membrane rows were appended to the
// "Torque & Cover" card when the surgical detail went in, so questions about
// grafting sat two cards away from the graft question they qualify. Torque and
// the cover screw have nothing to do with a membrane.
//
// They now live under "Osteotomy & Grafting", each specify row directly below
// the question it belongs to. The graft question itself reads Placed / Not
// Placed, the way Suture Placed already does — a "None" button said the same
// thing in a different voice, and the graft types now sit behind the answer.
//
// The checks below pin where each row sits, that Torque & Cover keeps only its
// own two questions, and — the part that matters clinically — that every row
// still appears when the answer above calls for it and still reaches the
// record, including a case saved before the question was worded this way.

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.resolve(__dirname, '..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'kbgraft-'));

function extract() {
  const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  const m = /const IMP_SURGERY_B64\s*=\s*([\s\S]*?);\n/.exec(html);
  if (!m) throw new Error('IMP_SURGERY_B64 not found');
  const b64 = (m[1].match(/"([^"]*)"/g) || []).map(s => s.slice(1, -1)).join('');
  const p = path.join(OUT, 'is.html');
  fs.writeFileSync(p, Buffer.from(b64, 'base64'));
  return { file: p, html: Buffer.from(b64, 'base64').toString('utf8') };
}

const checks = [];
const eq = (name, got, want) =>
  checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });
const ok = (name, cond, detail) =>
  checks.push({ name, ok: !!cond, got: detail, want: 'truthy' });

// Which card heading a given id sits under.
function cardOf(html, id) {
  const at = html.indexOf('id="' + id + '"');
  if (at < 0) return null;
  const heads = [...html.matchAll(/<div class="ch">([^<]*)</g)];
  let name = null;
  for (const h of heads) { if (h.index < at) name = h[1]; else break; }
  return name;
}

const GRAFT = 'Osteotomy &amp; Grafting';

(async () => {
  const { file, html } = extract();

  // ── where each row lives ────────────────────────────────────────────────
  for (const id of ['osteoType', 'addProc', 'graftPlaced', 'graftGrp', 'graftTypeRow',
                    'osteoOtherRow', 'graftOtherRow', 'graftDetailRow',
                    'membraneUsed', 'membraneDetailRow']) {
    ok(id + ' sits under Osteotomy & Grafting', /Osteotomy/.test(cardOf(html, id) || ''), cardOf(html, id));
  }
  ok('torque stays in Torque & Cover', /Torque/.test(cardOf(html, 'torqueVal') || ''), cardOf(html, 'torqueVal'));
  ok('the cover choice stays with it', /Torque/.test(cardOf(html, 'coverType') || ''), cardOf(html, 'coverType'));

  // Torque & Cover must be left with exactly its own two questions.
  const tcStart = html.indexOf('Torque &amp; Cover');
  const tcBody = html.slice(tcStart, html.indexOf('<div class="ch">', tcStart + 10));
  eq('Torque & Cover holds exactly two rows', (tcBody.match(/class="fr"/g) || []).length, 2);

  // A specify row is useless above the question it qualifies.
  const order = id => html.indexOf('id="' + id + '"');
  ok('Osteotomy — specify comes after Osteotomy Type',
    order('osteoOtherRow') > order('osteoType'), null);
  ok('Graft — specify comes after the graft choices',
    order('graftOtherRow') > order('graftGrp'), null);
  ok('graft brand/size/amount follows the graft choices',
    order('graftDetailRow') > order('graftGrp'), null);
  ok('membrane brand/size follows the membrane question',
    order('membraneDetailRow') > order('membraneUsed'), null);

  // Nothing may have been duplicated by the move.
  for (const id of ['graftDetailRow', 'membraneUsed', 'membraneDetailRow', 'osteoOtherRow',
                    'graftOtherRow', 'graftPlaced', 'graftTypeRow']) {
    eq(id + ' appears exactly once', html.split('id="' + id + '"').length - 1, 1);
  }

  // ── and the rows still work where they now are ──────────────────────────
  const browser = await chromium.launch(
    process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto('file://' + file);
  await page.waitForTimeout(300);

  const visible = id => page.evaluate(i => {
    const el = document.getElementById(i);
    return !!el && el.style.display !== 'none';
  }, id);
  const clickOpt = (groupId, label) => page.evaluate(({ groupId, label }) => {
    const g = document.getElementById(groupId);
    const b = Array.from(g.querySelectorAll('.btn')).find(x => x.textContent.trim() === label);
    if (!b) throw new Error('no option "' + label + '" in #' + groupId);
    b.click();
  }, { groupId, label });

  eq('nothing graft-related is showing at rest',
    [await visible('osteoOtherRow'), await visible('graftOtherRow'),
     await visible('graftDetailRow'), await visible('membraneDetailRow')],
    [false, false, false, false]);

  await clickOpt('osteoType', 'Other');
  eq('Osteotomy "Other" still reveals its box', await visible('osteoOtherRow'), true);

  // ── the graft question reads Placed / Not Placed ──────────────────────
  eq('the graft question offers Placed and Not Placed',
    await page.evaluate(() => Array.from(document.querySelectorAll('#graftPlaced .btn')).map(b => b.textContent.trim())),
    ['Placed', 'Not Placed']);
  eq('the old "None" button is gone',
    await page.evaluate(() => !!document.querySelector('[data-ss="graftNone"]')), false);
  eq('the graft types are hidden until a graft was placed', await visible('graftTypeRow'), false);

  await clickOpt('graftPlaced', 'Placed');
  eq('Placed reveals the graft types', await visible('graftTypeRow'), true);
  eq('and asks for brand/size/amount', await visible('graftDetailRow'), true);
  eq('but does not ask which graft until Other is chosen', await visible('graftOtherRow'), false);

  await clickOpt('graftGrp', 'Allograft');
  eq('a named graft leaves the specify box shut', await visible('graftOtherRow'), false);
  await clickOpt('graftGrp', 'Other');
  eq('graft "Other" still reveals its box', await visible('graftOtherRow'), true);

  await clickOpt('graftPlaced', 'Not Placed');
  eq('Not Placed puts every graft question away',
    [await visible('graftTypeRow'), await visible('graftOtherRow'), await visible('graftDetailRow')],
    [false, false, false]);
  await clickOpt('graftPlaced', 'Placed');
  await clickOpt('graftGrp', 'Other');

  await clickOpt('membraneUsed', 'Used');
  eq('a membrane still asks for brand/size', await visible('membraneDetailRow'), true);

  // The point of the card is that the answers still reach the record.
  await page.evaluate(() => {
    document.getElementById('graftBrand').value = 'Bio-Oss';
    document.getElementById('graftSize').value = '0.25–1.0 mm';
    document.getElementById('graftQty').value = '0.5 g';
    document.getElementById('membraneBrand').value = 'Bio-Gide';
    document.getElementById('membraneSize').value = '15×20 mm';
    document.getElementById('osteoOther').value = 'Ridge split';
    document.getElementById('graftOther').value = 'Xenograft mix';
    document.getElementById('pId').value = 'AL0777';
    document.getElementById('pName').value = 'Test Patient';
  });
  const summary = await page.evaluate(() => {
    const tab = document.querySelector('.tab[data-tab="4"]');
    tab.click();
    return document.getElementById('summaryContent').innerText;
  });
  for (const [what, text] of [['graft brand', 'Bio-Oss'], ['graft amount', '0.5 g'],
                              ['membrane brand', 'Bio-Gide'], ['osteotomy detail', 'Ridge split'],
                              ['which graft', 'Xenograft mix']]) {
    ok('the printed record still carries the ' + what, summary.includes(text),
      (summary.match(new RegExp('.{0,30}' + text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '.{0,20}')) || [''])[0]);
  }

  // ── a case saved before this wording ───────────────────────────────────
  // Older records carry graft:'None' for a case with no graft and a material
  // name for one with a graft. Both have to come back as an answer, or a
  // reopened record looks like nobody ever decided.
  const resumed = async record => {
    const p2 = await browser.newPage();
    p2.on('pageerror', e => errors.push('resume: ' + e.message));
    await p2.goto('file://' + file);
    await p2.waitForTimeout(300);
    await p2.evaluate(r => window.postMessage({ type: 'KB_CLINICAL_RECORD', record: r }, '*'), record);
    await p2.waitForTimeout(300);
    const out = await p2.evaluate(() => ({
      placed: Array.from(document.getElementById('graftPlaced').querySelectorAll('.btn.active')).map(b => b.textContent.trim()),
      types: Array.from(document.getElementById('graftGrp').querySelectorAll('.btn.active')).map(b => b.textContent.trim()),
      typeRowOpen: (() => { const e = document.getElementById('graftTypeRow'); return !!e && e.style.display !== 'none'; })(),
      other: (document.getElementById('graftOther') || {}).value || '',
    }));
    await p2.close();
    return out;
  };

  const oldNone = await resumed({ pName: 'X', pId: 'AL0777', graft: 'None', implants: [{ n: 1, site: '46' }] });
  eq("an older record's graft:'None' comes back as Not Placed", oldNone.placed, ['Not Placed']);
  eq('and leaves the graft types put away', oldNone.typeRowOpen, false);

  // Membrane and Mesh are no longer offered as graft materials — a membrane is
  // a barrier, and it has its own Placed question two rows below. A record
  // that chose one must not lose the answer.
  eq('Type of Graft no longer offers Membrane or Mesh',
    await page.evaluate(() => Array.from(document.querySelectorAll('#graftGrp [data-tm]')).map(b => b.textContent.trim())),
    ['Autogenous', 'Allograft', 'Other']);

  const oldMembrane = await resumed({ pName: 'X', pId: 'AL0777', graft: 'Membrane', implants: [{ n: 1, site: '46' }] });
  eq('a record that chose Membrane still reads as a graft placed', oldMembrane.placed, ['Placed']);
  eq('and comes back as Other rather than blank', oldMembrane.types, ['Other']);
  eq('with what was used written into the specify box', oldMembrane.other, 'Membrane');

  const oldMesh = await resumed({ pName: 'X', pId: 'AL0777', graft: 'Allograft, Mesh', implants: [{ n: 1, site: '46' }] });
  eq('a material still offered keeps its own button', oldMesh.types.includes('Allograft'), true);
  eq('and the dropped one is named in the specify box', oldMesh.other, 'Mesh');

  const oldGraft = await resumed({ pName: 'X', pId: 'AL0777', graft: 'Allograft', implants: [{ n: 1, site: '46' }] });
  eq('an older record with a material comes back as Placed', oldGraft.placed, ['Placed']);
  eq('with the material still selected', oldGraft.types, ['Allograft']);
  eq('and the types on show so it can be changed', oldGraft.typeRowOpen, true);

  const answered = await resumed({ pName: 'X', pId: 'AL0777', graftPlaced: 'Not Placed', graft: 'Not Placed', implants: [{ n: 1, site: '46' }] });
  eq('a record saved with the new answer reads straight back', answered.placed, ['Not Placed']);

  const unanswered = await resumed({ pName: 'X', pId: 'AL0777', graft: '—', implants: [{ n: 1, site: '46' }] });
  eq('a record that never answered stays unanswered', unanswered.placed, []);

  eq('no uncaught page errors', errors, []);
  await browser.close();

  let pass = 0, fail = 0;
  console.log('\n' + '='.repeat(78));
  console.log('IMPLANT SURGERY — GRAFT AND MEMBRANE ROWS BELONG WITH THE GRAFT QUESTION');
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
