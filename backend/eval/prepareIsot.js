// backend/eval/prepareIsot.js
// Merges the two ISOT dataset halves (Fake.csv label 0, True.csv label 1)
// into eval/data/isot.csv with the harness columns: title,text,label.
//
// Usage: node eval/prepareIsot.js
const fs = require('fs');
const path = require('path');
const { parseCsv, csvField } = require('./csv');

const DATA_DIR = path.join(__dirname, 'data');
const OUT = path.join(DATA_DIR, 'isot.csv');

function loadHalf(file, label) {
  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  const header = rows[0].map(h => h.trim().toLowerCase());
  const ti = header.indexOf('title'), xi = header.indexOf('text');
  if (ti === -1 || xi === -1) throw new Error(`${file}: expected title,text columns, got ${header.join(',')}`);
  return rows.slice(1)
    .map(r => ({ title: (r[ti] || '').trim(), text: (r[xi] || '').trim(), label }))
    .filter(it => it.title.length >= 10 && it.text.length >= 200);
}

const fake = loadHalf(path.join(DATA_DIR, 'Fake.csv'), 0);
const real = loadHalf(path.join(DATA_DIR, 'True.csv'), 1);
console.log(`Fake: ${fake.length} usable articles, Real: ${real.length} usable articles`);

const lines = ['title,text,label'];
for (const it of [...fake, ...real]) {
  lines.push(`${csvField(it.title)},${csvField(it.text)},${it.label}`);
}
fs.writeFileSync(OUT, lines.join('\n'));
console.log(`Wrote ${lines.length - 1} articles to ${OUT}`);
