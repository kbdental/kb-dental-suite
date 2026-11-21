// "In 3rd screen shot why is 35 coming when that tooth is not involved it
//  is actually taking 35 of T=35Ncm so check and rectify"
//
// "In screenshot We selected the endorsed treatments but in prescription
//  why extra are coming"
//
// "CGHS save is there but there is no date range"
//
// Three things the clinic found on the same screen.
//
// 1. A TORQUE READ AS A TOOTH. The sheets split a visit into a row per
//    thing done and put the tooth beside it, read off the note after
//    "wrt". That read ran to the end of the clause, so an implant note --
//    "placed wrt 15 at 35 Ncm" -- filed 35 as a second tooth. 35 is a
//    lower left second premolar, on the other side of a mouth where only
//    15 was touched. A wrong tooth on a clinical record is worse than no
//    tooth at all.
//
// 2. LINES NOBODY ASKED FOR. Stage 1 has a tick per line saying what this
//    run of work is about, and it defaults to everything not yet billed.
//    The prescription ignored it and took every endorsed line the plan
//    has ever held -- including four already billed, which the screen
//    itself calls finished with: "a claimed line cannot be changed or
//    billed again". The bill took them too, which is a second claim for
//    money already paid.
//
// 3. A DATE RANGE NOBODY COULD SEE. The search exists, with From and To,
//    behind a button that read "Saved Prescriptions" and so looked like a
//    place rather than a search. Reported as not being there at all.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');

const checks = [];
const ok = (name, cond, detail) => checks.push({ name, ok: !!cond, got: detail });
const eq = (name, got, want) => checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });

// ── 1 · what counts as a tooth in a line of notes ──────────────────────
const cut = (a, b) => html.slice(html.indexOf(a), html.indexOf(b, html.indexOf(a)));
let kbTeethInLine;
{
  const src = cut('function kbTeethInLine(line) {', '\n// `noteFields` in order of preference');
  kbTeethInLine = new Function(src + '\nreturn kbTeethInLine;')();
}

// The bug, named. Both of the clinic's implant templates put the torque
// in the same clause as the tooth, so both produced it.
eq('a torque in the same clause is not a second tooth',
   kbTeethInLine('Implant (Nobel, 4.3x10) placed wrt 15 at 35 Ncm, cover screw placed, sutured.'),
   ['15']);
eq('nor is one written with an equals sign',
   kbTeethInLine('Implant placed wrt 15, T=35Ncm, healing abutment placed.'), ['15']);
eq('nor one reached through a bracketed aside',
   kbTeethInLine('Extraction wrt 16 [+ curettage] with immediate implant (Nobel, 4.3) at 35 Ncm'),
   ['16']);
eq('nor a torque behind a comma, where the list looks like it continues',
   kbTeethInLine('Screw retrieved wrt 46, torqued to 35 Ncm'), ['46']);
eq('a millimetre reading is not a tooth either',
   kbTeethInLine('Indirect sinus lift wrt 16 region, membrane elevated 11 mm'), ['16']);

// And everything the sheets were already splitting correctly keeps working.
eq('a list of teeth is still read whole',
   kbTeethInLine('Post-endo composite wrt 44,45,47,42,43,15,17. GP removed 2mm below orifice.'),
   ['44','45','47','42','43','15','17']);
eq('spaces and "and" hold a list together',
   kbTeethInLine('Provisional 5 wrt 34, 35, 36, 37 and 38 with PMMA'), ['34','35','36','37','38']);
eq('"wrt implant 15" is about tooth 15, which is how three templates write it',
   kbTeethInLine('Loose screw retrieved wrt implant 15, new screw torqued to 35 Ncm'), ['15']);
eq('a hash still names a tooth', kbTeethInLine('RCT wrt #35 and #36'), ['35','36']);
eq('a canal length is still not a tooth', kbTeethInLine('BMP done wrt 36 under LA. MB=16mm-25/04'), ['36']);
eq('and a note naming no tooth still names none',
   kbTeethInLine('Full arch prosthesis wrt lower arch on 4 implants at 35 Ncm'), []);
// The next sentence's numbers were never in scope and still are not.
eq('the clause ends where the sentence does',
   kbTeethInLine('Composite wrt 46, 47 occlusally. Review in 21 days.'), ['46','47']);

// ── 2 · what the prescription and the bill are for ─────────────────────
ok('stage 1’s ticks decide it, and a billed line is excluded whatever is ticked',
   /const onThisRun = e\.approved\.filter\(x =>\s*\n?\s*pickList\.indexOf\(x\.at\) >= 0 && !\(x\.r && x\.r\.endBilled\)\);/.test(html));
ok('the prescription is handed that list and not every endorsed line',
   /CghsPrescription, \{ pat: pat, lines: onThisRun, plan: notePlan \}/.test(html)
   && !/lines: e\.approved/.test(html));
ok('and so is the bill, so a claimed line cannot be claimed twice',
   /holder: e\.holder, lines: onThisRun, onBilled: e\.markBilled \}/.test(html));
ok('neither stage is drawn when that list is empty',
   /stage === "prescription" && \(onThisRun\.length/.test(html)
   && /stage === "bill" && \(onThisRun\.length/.test(html));
// Four different reasons for an empty stage 2, and the clinic is told
// which one it is looking at -- "nothing is ticked" and "it has all been
// billed already" need different things done about them.
ok('an empty stage says which of the four reasons it is',
   /There is no endorsement for this patient yet/.test(html)
   && /Nothing on this endorsement is ticked yet/.test(html)
   && /Every endorsed line here has already been billed/.test(html)
   && /None of the endorsed lines are included/.test(html));
// The column drives three documents now, so it no longer says "Print".
ok('the tick column is named for what it does', /\}\), "Include"\)\) : null,/.test(html));
ok('and each tick says so', /title: "Keep this line on the request, the prescription and the bill"/.test(html));

// ── 3 · the date range, where it can be found ──────────────────────────
ok('the button says it is a search, by date',
   /"\\uD83D\\uDD0E Find a saved prescription \\u00b7 by date"/.test(html));
ok('opening it runs the search rather than waiting to be asked again',
   /setFound\(null\); setFindOpen\(true\);\s*\n\s*runFind\(u, f, t\);/.test(html));
ok('and the Search button runs the same one', /const doFind = \(\) => runFind\(findUhid, findFrom, findTo\);/.test(html));

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String((e && e.message) || e)));
  await page.setContent('<body style="margin:0;padding:16px;font-family:system-ui"><div id="root"></div></body>');
  for (const f of ['node_modules/react/umd/react.production.min.js',
                   'node_modules/react-dom/umd/react-dom.production.min.js'])
    await page.addScriptTag({ content: fs.readFileSync(path.join(REPO, f), 'utf8') });
  await page.addScriptTag({ content: `
    const T="#0078B4", BORDER="#e5e5e0", BGS="#f5f5f0";
    const inp={padding:"6px 10px",fontSize:14,border:"1px solid #e5e5e0",borderRadius:6,
               background:"#fff",color:"#1a1a1a",width:"100%",boxSizing:"border-box",fontFamily:"inherit"};
    window.__calls = [];
    const api = (a, p) => {
      window.__calls.push([a, p]);
      if (a === "listCghsPrescriptions") return Promise.resolve({ success:true, prescriptions:[
        { date:"2026-11-04", uhid:"AL1010", patientName:"Santosh",
          treatments:"Flap Surgery- Per Tooth", teeth:"16", sittings:"1",
          document: JSON.stringify({ date:"2026-11-04", pat:{ name:"Santosh", uhid:"AL1010" },
            rows:[{ code:"DP007", name:"Flap Surgery- Per Tooth", tooth:"16", qty:1,
                    sits:[{ date:"2026-11-04", text:"Flap raised wrt 16." }] }] }) }
      ] });
      return Promise.resolve({ success:true });
    };
    window.CLINIC = { name: "K.B. Dental Clinic" };
  ` });
  await page.addScriptTag({ content: cut('const CLINIC_TZ', '\n') + '\n' +
    cut('function fmtDMY(input) {', 'const UPPER_T = [') });
  await page.addScriptTag({ content: cut('function calcAge(dob, today) {', 'function togArr(') });
  await page.addScriptTag({ content: cut('function toISODate(d) {', '\nfunction ') });
  await page.addScriptTag({ content:
    cut('// The pad is pre-printed stationery, so both sheets below', 'function EndorsementView(') });
  await page.addScriptTag({ content: cut('function clinicalTemplateRefs(cell) {', '\nfunction ') });

  await page.evaluate((p) => {
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(CghsPrescription, p));
  }, { pat: { name:'Santosh', uhid:'AL1010', dob:'05/07/1968' },
       lines: [{ at:0, code:'DP007', r:{ procedure:'Flap Surgery- Per Tooth', tooth:'16', qty:1 },
                 card:{ rate:'450' }, rate:450, qty:1, priced:true, amt:450 }],
       plan: [] });
  await page.waitForTimeout(350);

  const labels = () => page.$$eval('button', bs => bs.map(b => b.textContent.trim()));
  ok('the search is offered as a search', (await labels()).some(t => /Find a saved prescription/.test(t)),
     JSON.stringify(await labels()));

  await page.evaluate(() => { document.querySelectorAll('button')
    .forEach(b => { if (/Find a saved prescription/.test(b.textContent)) b.click(); }); });
  await page.waitForTimeout(350);

  const fields = await page.$$eval('input[type=date]', is => is.map(i => i.value));
  ok('a From and a To are on the screen once it is open', fields.length >= 4, JSON.stringify(fields));
  const span = await page.evaluate(() => {
    const got = [];
    document.querySelectorAll('div').forEach(d => {
      const t = d.textContent.trim();
      if (d.children.length === 0 && (t === 'From' || t === 'To' || /^UHID \(/.test(t))) got.push(t);
    });
    return got;
  });
  eq('named, so the range can be seen rather than guessed at',
     span, ['UHID (blank = every patient)', 'From', 'To']);

  const called = await page.evaluate(() => window.__calls.filter(c => c[0] === 'listCghsPrescriptions'));
  eq('and it has already searched the last month, unasked', called.length, 1);
  ok('over a real range of dates',
     called[0] && called[0][1] && /^\d{4}-\d{2}-\d{2}$/.test(called[0][1].from)
     && /^\d{4}-\d{2}-\d{2}$/.test(called[0][1].to) && called[0][1].from < called[0][1].to,
     JSON.stringify(called[0] && called[0][1]));
  ok('for the patient on the screen, which can be cleared to look wider',
     called[0] && called[0][1] && called[0][1].uhid === 'AL1010');
  ok('what it found is listed, ready to reprint',
     (await labels()).some(t => /Print$/.test(t)), JSON.stringify(await labels()));

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
