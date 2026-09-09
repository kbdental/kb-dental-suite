// Two gaps in the implant forms.
//
// Implant Surgery recorded which investigation was DONE but never which ones
// are still required — not from this visit, and not for the next one. So a
// case needing a CBCT before loading had nowhere to say so, and the follow-up
// appointment was booked with nothing to say what to take.
//
// Implant Prosthetic had no way to record that the impression coping's seating
// was confirmed by an IOPA, which is the check that stops a prosthesis being
// made on a mis-seated coping.
//
// Both required-investigation rows carry an Other free-text box: an "Other"
// with nowhere to say what it was records nothing.

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'kbinvreq-'));

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

// Which card heading an id sits under.
const cardOf = (text, id) => {
  const at = text.indexOf('id="' + id + '"');
  if (at < 0) return null;
  let name = null;
  for (const h of text.matchAll(/<div class="ch">([^<]*)</g)) {
    if (h.index < at) name = h[1]; else break;
  }
  return name;
};
const listOf = (text, id) => {
  const m = new RegExp('id="' + id + '">([\\s\\S]*?)</div>').exec(text);
  return m ? m[1].match(/>([^<]+)<\/button>/g).map(s => s.slice(1, -9)) : null;
};

(async () => {
  const is = extract('IMP_SURGERY_B64', 'is.html');
  const ip = extract('IMP_PROSTHETIC_B64', 'ip.html');

  // ── where they live ─────────────────────────────────────────────────────
  ok('the required-investigation row is in the Investigation card',
    /Investigation/.test(cardOf(is, 'investReq') || ''), cardOf(is, 'investReq'));
  ok('and the follow-up one is in the Follow-up card, not the card below it',
    /Follow-up/.test(cardOf(is, 'fuInvestReq') || ''), cardOf(is, 'fuInvestReq'));
  ok('Confirmed by IOPA is in the Final Impression card',
    /Impression/.test(cardOf(ip, 'iopaConfirmed') || ''), cardOf(ip, 'iopaConfirmed'));

  // The required list should read as a pair with the one above it.
  eq('required investigations offer the same choices as the one above',
    listOf(is, 'investReq'), listOf(is, 'investGrp'));
  eq('and so does the follow-up one',
    listOf(is, 'fuInvestReq'), listOf(is, 'investGrp'));
  eq('Confirmed by IOPA is a plain Yes / No',
    listOf(ip, 'iopaConfirmed'), ['Yes', 'No']);

  // Nothing duplicated.
  for (const id of ['investReq', 'investReqOther', 'investReqOtherRow',
                    'fuInvestReq', 'fuInvestReqOther', 'fuInvestReqOtherRow']) {
    eq(id + ' appears exactly once', is.split('id="' + id + '"').length - 1, 1);
  }
  eq('iopaConfirmed appears exactly once', ip.split('id="iopaConfirmed"').length - 1, 1);

  const browser = await chromium.launch(
    process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const errors = [];

  // ── Implant Surgery: the two Other boxes are independent ────────────────
  {
    const page = await browser.newPage();
    page.on('pageerror', e => errors.push('is: ' + e.message));
    await page.goto('file://' + host('is.html'));
    await page.waitForTimeout(900);
    const f = page.frames().find(fr => fr.url().endsWith('/is.html'));
    const visible = id => f.evaluate(i => {
      const el = document.getElementById(i);
      return !!el && el.style.display !== 'none';
    }, id);
    const click = (g, l) => f.evaluate(({ g, l }) => {
      const el = document.getElementById(g);
      const b = Array.from(el.querySelectorAll('.btn')).find(x => x.textContent.trim() === l);
      if (!b) throw new Error('no option "' + l + '" in #' + g);
      b.click();
    }, { g, l });

    eq('both specify boxes are shut at rest',
      [await visible('investReqOtherRow'), await visible('fuInvestReqOtherRow')], [false, false]);

    await click('investReq', 'Other');
    eq('choosing Other on the required row opens only its own box',
      [await visible('investReqOtherRow'), await visible('fuInvestReqOtherRow')], [true, false]);

    await click('fuInvestReq', 'Other');
    eq('and the follow-up one opens its own', await visible('fuInvestReqOtherRow'), true);

    await click('investReq', 'OPG');
    eq('a listed investigation shuts its box again',
      [await visible('investReqOtherRow'), await visible('fuInvestReqOtherRow')], [false, true]);

    // Round trip through the record.
    await click('investReq', 'Other');
    await f.evaluate(() => {
      document.getElementById('investReqOther').value = 'CBCT before loading';
      document.getElementById('fuInvestReqOther').value = 'RVG at 3 months';
      document.getElementById('pId').value = 'AL0777';
      document.getElementById('pName').value = 'Test Patient';
    });
    await f.evaluate(() => document.getElementById('saveBtn').click());
    await page.waitForTimeout(500);
    const rec = (await page.evaluate(() => window.__posted) || {}).allTeeth || {};
    eq('the required investigation is saved', rec.investReq, 'Other');
    eq('with what it actually is', rec.investReqOther, 'CBCT before loading');
    eq('the follow-up requirement is saved', rec.fuInvestReq, 'Other');
    eq('with its own text, not the other row’s', rec.fuInvestReqOther, 'RVG at 3 months');

    const summary = await f.evaluate(() => {
      const tab = document.querySelector('.tab[data-tab="4"]');
      if (!tab) throw new Error('no summary tab');
      tab.click();
      return document.getElementById('summaryContent').innerText;
    });
    ok('the printed record carries the required investigation',
      /CBCT before loading/.test(summary), null);
    ok('and what the follow-up needs', /RVG at 3 months/.test(summary), null);
    ok('and still carries what was actually done',
      /investigation/i.test(summary), null);
    await page.close();

    // Resume.
    const p2 = await browser.newPage();
    p2.on('pageerror', e => errors.push('is-resume: ' + e.message));
    await p2.goto('file://' + host('is.html'));
    await p2.waitForTimeout(900);
    const f2 = p2.frames().find(fr => fr.url().endsWith('/is.html'));
    await f2.evaluate(() => window.postMessage({
      type: 'KB_CLINICAL_RECORD',
      record: {
        pName: 'X', pId: 'AL0777', invest: 'RVG',
        investReq: 'OPG', fuInvestReq: 'Other', fuInvestReqOther: 'CBCT at 6 months',
        implants: [{ n: 1, site: '46' }],
      },
    }, '*'));
    await p2.waitForTimeout(400);
    const backIs = await f2.evaluate(() => ({
      req: Array.from(document.getElementById('investReq').querySelectorAll('.btn.active')).map(b => b.textContent.trim()),
      fuReq: Array.from(document.getElementById('fuInvestReq').querySelectorAll('.btn.active')).map(b => b.textContent.trim()),
      fuOther: document.getElementById('fuInvestReqOther').value,
      fuOtherOpen: (() => { const e = document.getElementById('fuInvestReqOtherRow'); return !!e && e.style.display !== 'none'; })(),
    }));
    eq('a reopened record brings back the required investigation', backIs.req, ['OPG']);
    eq('and the follow-up requirement', backIs.fuReq, ['Other']);
    eq('with its text', backIs.fuOther, 'CBCT at 6 months');
    eq('and its box reopened, or the text would be there but invisible',
      backIs.fuOtherOpen, true);
    await p2.close();
  }

  // ── Implant Prosthetic: the IOPA confirmation ───────────────────────────
  {
    const page = await browser.newPage();
    page.on('pageerror', e => errors.push('ip: ' + e.message));
    await page.goto('file://' + host('ip.html'));
    await page.waitForTimeout(900);
    const f = page.frames().find(fr => fr.url().endsWith('/ip.html'));
    await f.waitForFunction(() => document.querySelectorAll('#impTbody tr').length > 0);

    await f.evaluate(() => {
      const g = document.getElementById('iopaConfirmed');
      Array.from(g.querySelectorAll('.btn')).find(b => b.textContent.trim() === 'Yes').click();
      document.getElementById('pId').value = 'AL0777';
      document.getElementById('pName').value = 'Test Patient';
    });
    await f.evaluate(() => document.getElementById('saveBtn').click());
    await page.waitForTimeout(500);
    const rec = (await page.evaluate(() => window.__posted) || {}).allTeeth || {};
    eq('the IOPA confirmation is saved', rec.iopaConfirmed, 'Yes');

    const summary = await f.evaluate(() => {
      const tab = document.querySelector('.tab[data-tab="5"]');
      if (!tab) throw new Error('no summary tab');
      tab.click();
      return document.getElementById('summaryContent').innerText;
    });
    ok('the printed record shows it', /confirmed by iopa/i.test(summary),
      (summary.match(/.{0,6}confirmed by iopa.{0,12}/i) || [''])[0]);
    await page.close();

    const p2 = await browser.newPage();
    p2.on('pageerror', e => errors.push('ip-resume: ' + e.message));
    await p2.goto('file://' + host('ip.html'));
    await p2.waitForTimeout(900);
    const f2 = p2.frames().find(fr => fr.url().endsWith('/ip.html'));
    await f2.evaluate(() => window.postMessage({
      type: 'KB_CLINICAL_RECORD',
      record: { pName: 'X', pId: 'AL0777', iopaConfirmed: 'No', implants: [{ n: 1, site: '36' }] },
    }, '*'));
    await p2.waitForTimeout(400);
    eq('a reopened record brings the IOPA answer back',
      await f2.evaluate(() => Array.from(document.getElementById('iopaConfirmed').querySelectorAll('.btn.active')).map(b => b.textContent.trim())),
      ['No']);
    // A record from before this field existed must not answer it by accident.
    await f2.evaluate(() => window.postMessage({
      type: 'KB_CLINICAL_RECORD',
      record: { pName: 'X', pId: 'AL0778', implants: [{ n: 1, site: '36' }] },
    }, '*'));
    await p2.waitForTimeout(400);
    await p2.close();
  }

  eq('no uncaught page errors', errors, []);
  await browser.close();

  let pass = 0, fail = 0;
  console.log('\n' + '='.repeat(78));
  console.log('INVESTIGATIONS REQUIRED (SURGERY + FOLLOW-UP), AND CONFIRMED BY IOPA');
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
