import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const RAW = process.argv[2];
const META = process.argv[3];

function parseCupStanding(lines) {
  const idx = lines.findIndex(l => l.includes('杯赛积分排名'));
  if (idx < 0) return null;
  const out = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const c = lines[i].split('\t').map(x => x.trim());
    if (c.length < 10) continue;
    const rank = parseInt(c[0]);
    if (!Number.isFinite(rank)) continue;
    const v = c.slice(2).map(Number);
    if (v.some(x => !Number.isFinite(x))) continue;
    out.push({ rank, name: c[1], p: v[0], w: v[1], d: v[2], l: v[3], gf: v[4], ga: v[5], gd: v[6], points: v[7] });
  }
  return out.length ? out : null;
}

const meta = JSON.parse(readFileSync(META, 'utf8'));
const items = meta.matches || meta;
for (const it of items) {
  const txt = readFileSync(join(RAW, `${it.id}.txt`), 'utf8');
  const st = parseCupStanding(txt.split(/\r?\n/));
  console.log(`\n===== ${it.no} ${it.home} vs ${it.away} [${it.lg}] id=${it.id} =====`);
  if (!st) { console.log('  无杯赛积分段'); continue; }
  for (const r of st) {
    console.log(`  #${r.rank} ${r.name}  场${r.p} ${r.w}胜${r.d}平${r.l}负  ${r.gf}:${r.ga} 净${r.gd}  ${r.points}分`);
  }
}
