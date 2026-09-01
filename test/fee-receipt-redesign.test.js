// Checks the redesigned Fee Receipt: it now matches the clinic's printed
// paper receipt pad (boxed Receipt No./Dated, Received with Thanks
// from/UHID, "the sum of Rupees" in words, payment mode + instrument
// no./date, Transfer from/Drawn on, "on Account of" fixed to "Dental
// Treatment", boxed Rs. amount, Authorised Signatory).
//
// index.html pulls React/html2canvas/jsPDF from a CDN, which this sandbox's
// network policy blocks for a real browser load — so instead of spinning up
// a full page (like templates.test.js does for the self-contained forms),
// the handful of pure string-building functions this feature added are
// extracted straight from index.html's source by line range (same trick
// treatment-case.test.js uses for Code.gs) and run under Node's vm. This
// covers the actual content logic; the html2canvas/jsPDF wiring itself is
// simple enough (documented inline in index.html) to be a fair tradeoff
// against a network-dependent test that can't run in this environment.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.resolve(__dirname, '..');
const lines = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8').split('\n');

function extract(startMarker, endMarker) {
  const start = lines.findIndex(l => l.startsWith(startMarker));
  if (start < 0) throw new Error('could not find ' + startMarker);
  const end = lines.findIndex((l, i) => i > start && l.startsWith(endMarker));
  if (end < 0) throw new Error('could not find ' + endMarker + ' after ' + startMarker);
  return lines.slice(start, end).join('\n');
}

const src = [
  extract('function fmtDMY', 'function getDoctors'),
  extract('function fmtRs', 'function amountInWordsIndian'),
  extract('function amountInWordsIndian', 'function buildReceiptHTML'),
  extract('function buildReceiptHTML', 'function generateReceiptPrint'),
].join('\n\n');

const ctx = { window: { LOGO_B64: 'data:image/png;base64,STUB' }, console };
vm.createContext(ctx);
vm.runInContext(src, ctx);
const { fmtDMY, fmtRs, amountInWordsIndian, buildReceiptHTML } = ctx;

const checks = [];
const eq = (name, got, want) => checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });
const ok = (name, cond, detail) => checks.push({ name, ok: !!cond, got: detail, want: 'truthy' });

// --- amount in words -----------------------------------------------------
eq('small amount in words', amountInWordsIndian(500), 'Rupees Five Hundred Only');
eq('thousands amount in words', amountInWordsIndian(5600), 'Rupees Five Thousand Six Hundred Only');
eq('lakh amount in words', amountInWordsIndian(150000), 'Rupees One Lakh Fifty Thousand Only');
eq('crore amount in words', amountInWordsIndian(12345678), 'Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Only');
eq('zero amount in words', amountInWordsIndian(0), 'Rupees Zero Only');
eq('round thousand has no trailing zero words', amountInWordsIndian(2000), 'Rupees Two Thousand Only');

// --- receipt HTML matches the printed pad's field set ---------------------
const SAMPLE = { receiptNo: '1042', date: '2026-09-01', uhid: 'AL0777', patientName: 'Test Patient',
  fee: 5000, mode: 'Cash', service: 'RCT' };
const html = buildReceiptHTML(SAMPLE);
ok('has CARES header', html.includes('C. A. R. E. S.'));
ok('has "Receipt No." field', html.includes('Receipt No.'));
ok('has "Received with Thanks from" field', html.includes('Received with Thanks from'));
ok('has UHID field', html.includes('UHID:'));
ok('has "the sum of Rupees" field with amount in words', html.includes('the sum of Rupees') && html.includes('Rupees Five Thousand Only'));
ok('has payment mode line (Cash/Cheque/Draft/NEFT)', /Cash.*Cheque.*Draft.*NEFT/.test(html.replace(/<[^>]+>/g, ' ')));
ok('the picked payment mode (Cash) is highlighted in that line', /color:#0078B4;">Cash</.test(html));
ok('has "Transfer from / Drawn on" field', html.includes('Transfer from / Drawn on'));
ok('"on Account of" always reads Dental Treatment', html.includes('>Dental Treatment<'));
ok('has boxed Rs. amount', html.includes('Rs.') && html.includes(fmtRs(5000)));
ok('has Authorised Signatory line', html.includes('Authorised Signatory'));
ok('has "For K.B. Dental Clinic Delhi"', html.includes('For K.B. Dental Clinic Delhi'));

// A service picked for the fee (e.g. "RCT") must NOT leak onto the receipt —
// "on Account of" is always the fixed "Dental Treatment" text, never the
// specific procedure, matching the printed pad.
ok('the specific service picked for the fee is not shown on the receipt', !html.includes('>RCT<') && !/of[^<]*RCT/.test(html));

const html2 = buildReceiptHTML({ ...SAMPLE, service: 'ZzUniqueServiceMarker' });
ok('holds even for an unusual service value', !html2.includes('ZzUniqueServiceMarker'));

// A different payment mode highlights correctly, not just Cash.
const htmlCheque = buildReceiptHTML({ ...SAMPLE, mode: 'Cheque' });
ok('Cheque mode is highlighted when that is the mode used', /color:#0078B4;">Cheque</.test(htmlCheque));
ok('Cash is NOT highlighted when the mode is Cheque', !/color:#0078B4;">Cash</.test(htmlCheque));

let pass = 0, fail = 0;
console.log('\n' + '='.repeat(78));
console.log('FEE RECEIPT — REDESIGN (AMOUNT IN WORDS, PRINTED-PAD LAYOUT)');
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
