const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', 'data');
const dirs = fs.readdirSync(root).filter(d => /^raw\d+$/.test(d)).sort((a, b) => parseInt(a.slice(3)) - parseInt(b.slice(3)));
const rows = [];
for (const d of dirs) {
  const dp = path.join(root, d);
  for (const f of fs.readdirSync(dp)) {
    if (!f.endsWith('.handicap.json')) continue;
    const id = f.replace('.handicap.json', '');
    const h = JSON.parse(fs.readFileSync(path.join(dp, f), 'utf8'));
    if (Math.abs(h.hc) === 0.25) {
      rows.push({ raw: d, id, hc: h.hc, openHc: h.open.hc, ou: h.ou });
    }
  }
}
console.log('即时|hc|=0.25 共', rows.length, '场（含重复）:');
for (const r of rows) console.log(r.raw, r.id, 'hc=' + r.hc, 'open=' + r.openHc, 'ou=' + r.ou);
