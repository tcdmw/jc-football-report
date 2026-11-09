// 从 _odds_raw.json 生成 6 个 {id}.handicap.json
import { readFileSync, writeFileSync } from 'node:fs';

const root = 'data/raw13';
const raw = JSON.parse(readFileSync(root + '/_odds_raw.json', 'utf8'));

for (const id of Object.keys(raw)) {
  const { asian, ou } = raw[id];
  const num = s => parseFloat(s);
  const obj = {
    hc: num(asian.live.goals),
    live: {
      aw: asian.live.right,
      hc: num(asian.live.goals),
      hw: asian.live.left,
      ouLine: ou.live.line,
      over: ou.live.left,
      raw: '澳门',
      under: ou.live.right
    },
    open: {
      aw: asian.open.right,
      hc: num(asian.open.goals),
      hw: asian.open.left,
      ouLine: ou.open.line,
      over: ou.open.left,
      raw: '澳门',
      under: ou.open.right
    },
    ou: ou.live.line,
    ouOver: ou.live.left,
    ouUnder: ou.live.right,
    raw: '澳门',
    source: '澳门'
  };
  writeFileSync(root + `/${id}.handicap.json`, JSON.stringify(obj, null, 1), 'utf8');
  console.log(id, 'hc=', obj.hc, 'ou=', obj.ou);
}
