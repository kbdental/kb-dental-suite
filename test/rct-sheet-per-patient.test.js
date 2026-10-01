// The RCT form kept its working sheet in localStorage under one key for the
// whole browser: "kb_rct_sheet". localStorage is per-origin, not per patient,
// so the sheet left over from the last patient was still loaded when the next
// one was opened. Three faults followed, all reported from the clinic:
//
//   - a new patient's tooth 26 collided with the previous patient's, and the
//     form refused the save saying the tooth was already in the sheet;
//   - the four-tooth sheet filled up across patients rather than within one;
//   - and a save then wrote the PREVIOUS patient's teeth out under THIS
//     patient's UHID, because postClinicalSheet takes identity from the open
//     form. That is the one that silently corrupts records.
//
// This drives the real form in a browser, with two patients in turn.

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

// Pull the form out of the page exactly as the app embeds it.
const m = /(?:const|var|let)\s+RCT_FORM_B64\s*=\s*((?:"[^"]*"\s*\+?\s*)+);/.exec(html);
const form = Buffer.from((m[1].match(/"([^"]*)"/g) || [])
  .map(s => s.slice(1, -1)).join(''), 'base64').toString('utf8');

// --- the source contract, so a later edit cannot quietly undo this ---------
ok('the sheet key is built from the patient, not a constant',
  /function sheetKey\(\)/.test(form));
// Check the storage CALLS, not every mention: a comment explaining the old
// key is not a bug, but a getItem/setItem/removeItem still using it is.
const storageCalls = form.match(/localStorage\.(?:getItem|setItem|removeItem)\([^,)]*/g) || [];
ok('there are storage calls to check', storageCalls.length > 0, storageCalls.length);
eq('every sheet storage call goes through sheetKey()',
  storageCalls.filter(c => !/\(\s*sheetKey\(/.test(c)), []);
ok('the blocking "already in the sheet" prompt is gone',
  !/already in the sheet\. Replace it\?/.test(form));

(async () => {
  const file = path.join(os.tmpdir(), 'kb-rct-form-test.html');
  fs.writeFileSync(file, form);
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
  const page = await browser.newPage();
  // A blocked dialog would hang the run and, in the app, is the very thing
  // being removed — so record any that fire and dismiss them.
  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
  await page.goto('file://' + file);
  await page.waitForTimeout(400);

  // Save tooth `tooth` for patient `id`, the way the form does it.
  const saveFor = (id, tooth) => page.evaluate(([id, tooth]) => {
    document.getElementById('pId').value = id;
    document.getElementById('pName').value = 'Patient ' + id;
    window.selTooth = tooth;
    document.getElementById('saveToSheet').click();
    return true;
  }, [id, tooth]);

  const keysNow = () => page.evaluate(() =>
    Object.keys(localStorage).filter(k => k.indexOf('kb_rct_sheet') === 0).sort());
  const entriesFor = (id) => page.evaluate((id) => {
    const raw = localStorage.getItem('kb_rct_sheet_' + id);
    return raw ? (JSON.parse(raw).entries || []).map(e => String(e.tooth)) : null;
  }, id);

  await saveFor('AL0801', '26');
  await page.waitForTimeout(100);
  eq('the first patient\'s tooth is saved under their own key',
    await entriesFor('AL0801'), ['26']);

  // The same tooth number, a different patient. This is the reported bug.
  await saveFor('AL0802', '26');
  await page.waitForTimeout(100);
  eq('the second patient keeps their own sheet', await entriesFor('AL0802'), ['26']);
  eq('and the first patient\'s record is untouched',
    await entriesFor('AL0801'), ['26']);
  eq('no dialog interrupts a different patient with the same tooth', dialogs, []);
  eq('the two patients have two separate keys',
    await keysNow(), ['kb_rct_sheet_AL0801', 'kb_rct_sheet_AL0802']);

  // Four teeth for one patient must not be filled up by another's.
  for (const t of ['11', '12', '13']) await saveFor('AL0802', t);
  await page.waitForTimeout(100);
  eq('a sheet fills from one patient only', await entriesFor('AL0802'), ['26', '11', '12', '13']);
  eq('the other patient still has just their one tooth',
    await entriesFor('AL0801'), ['26']);

  // Continuing the same tooth at a later appointment must not be refused.
  dialogs.length = 0;
  await saveFor('AL0801', '26');
  await page.waitForTimeout(100);
  eq('saving the same tooth again does not ask to replace', dialogs, []);
  eq('and does not duplicate the entry', await entriesFor('AL0801'), ['26']);

  await browser.close();
  fs.unlinkSync(file);

  let pass = 0, fail = 0;
  console.log('\n' + '='.repeat(78));
  console.log('RCT — ONE SHEET PER PATIENT, NOT ONE PER BROWSER');
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
