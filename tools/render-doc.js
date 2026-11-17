// Renders docs/WORKFLOW.md to a readable page. Handles only what that file
// uses -- headings, tables, fenced code, lists (wrapped items included) and
// paragraphs -- and nothing it does not.
const fs = require('fs');
const path = require('path');
const SRC = process.argv[2] || path.join(__dirname, '..', 'docs', 'WORKFLOW.md');
const OUT = process.argv[3] || SRC.replace(/\.md$/, '.html');
const md = fs.readFileSync(SRC, 'utf8');
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = s => esc(s)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
const isMarker = l => /^(\||```|#|---\s*$|[-*] |\d+\. |> )/.test(l);
const lines = md.split('\n'); const out = []; let i = 0;
while (i < lines.length) {
  const l = lines[i];
  if (/^```/.test(l)) { const buf = []; i++;
    while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
    i++; out.push('<pre><code>' + esc(buf.join('\n')) + '</code></pre>'); continue; }
  if (/^\|/.test(l)) { const rows = [];
    while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
    const cells = r => r.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    out.push('<table><thead><tr>' + cells(rows[0]).map(h => '<th>' + inline(h) + '</th>').join('')
      + '</tr></thead><tbody>' + rows.slice(2).map(r =>
        '<tr>' + cells(r).map(c => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('')
      + '</tbody></table>'); continue; }
  if (/^### /.test(l)) { out.push('<h3>' + inline(l.slice(4)) + '</h3>'); i++; continue; }
  if (/^## /.test(l)) { out.push('<h2>' + inline(l.slice(3)) + '</h2>'); i++; continue; }
  if (/^# /.test(l)) { out.push('<h1>' + inline(l.slice(2)) + '</h1>'); i++; continue; }
  if (/^---\s*$/.test(l)) { out.push('<hr>'); i++; continue; }
  // A blockquote is an aside the page sets apart, and its wrapped lines
  // belong to it the same way a list item's do.
  if (/^> /.test(l)) { const buf = [];
    while (i < lines.length && /^> /.test(lines[i])) buf.push(lines[i++].replace(/^> /, ''));
    out.push('<blockquote>' + inline(buf.join(' ')) + '</blockquote>'); continue; }
  const bullet = /^[-*] /.test(l), numbered = /^\d+\. /.test(l);
  if (bullet || numbered) {
    const re = bullet ? /^[-*] / : /^\d+\. /;
    const items = [];
    while (i < lines.length && (re.test(lines[i]) || (items.length && lines[i].trim() && !isMarker(lines[i])))) {
      // A wrapped line belongs to the item above it, not to a paragraph
      // after the list -- which is what broke the POST bullet in half.
      if (re.test(lines[i])) items.push(lines[i].replace(re, ''));
      else items[items.length - 1] += ' ' + lines[i].trim();
      i++;
    }
    const tag = bullet ? 'ul' : 'ol';
    out.push('<' + tag + '>' + items.map(x => '<li>' + inline(x) + '</li>').join('') + '</' + tag + '>');
    continue; }
  if (l.trim() === '') { i++; continue; }
  const para = [];
  while (i < lines.length && lines[i].trim() !== '' && !isMarker(lines[i])) para.push(lines[i++]);
  out.push('<p>' + inline(para.join(' ')) + '</p>');
}
const CSS = `
:root{--bg:#fbfbf9;--card:#fff;--ink:#17191a;--mute:#5a5a5a;--line:#e5e5e0;--acc:#0078B4;--code:#f2f5f7}
@media(prefers-color-scheme:dark){:root{--bg:#131415;--ink:#e8e8e6;--mute:#a3a39f;--line:#2d3031;--acc:#4ab3e8;--code:#1f2325}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 Inter,system-ui,sans-serif;padding:0 0 70px}
main{max-width:760px;margin:0 auto;padding:0 20px}
h1{font-size:30px;letter-spacing:-.02em;margin:34px 0 8px}
h2{font-size:20px;letter-spacing:-.01em;margin:40px 0 12px}
h3{font-size:16px;margin:26px 0 8px;color:var(--acc)}
p{margin:0 0 14px}ul,ol{margin:0 0 16px;padding-left:22px}li{margin-bottom:7px}
hr{border:none;border-top:1px solid var(--line);margin:34px 0}
code{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:.87em;background:var(--code);padding:1px 5px;border-radius:4px}
pre{background:var(--code);border:1px solid var(--line);border-radius:9px;padding:13px 15px;overflow-x:auto;margin:0 0 16px}
pre code{background:none;padding:0;font-size:13px;line-height:1.6}
table{width:100%;border-collapse:collapse;margin:0 0 18px;font-size:14.5px;display:block;overflow-x:auto}
th{text-align:left;font-weight:700;color:var(--acc);border-bottom:1.5px solid var(--line);padding:7px 10px;white-space:nowrap}
td{border-bottom:1px solid var(--line);padding:7px 10px;vertical-align:top}
strong{font-weight:700}
blockquote{margin:0 0 16px;padding:11px 15px;border-left:3px solid var(--acc);
background:var(--code);border-radius:0 7px 7px 0;color:var(--mute);font-size:15px}
blockquote code{background:var(--bg)}`;
fs.writeFileSync(OUT,
  '<!doctype html><html lang="en"><head><meta charset="utf-8">'
  + '<meta name="viewport" content="width=device-width,initial-scale=1">'
  + '<title>' + (/^# (.+)$/m.exec(md) || [, 'Document'])[1] + '</title>'
  + '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&family=JetBrains+Mono:wght@400;600&display=swap">'
  + '<style>' + CSS + '</style></head><body><main>' + out.join('\n') + '</main></body></html>');
console.log('rendered ' + OUT);
