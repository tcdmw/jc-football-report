#!/usr/bin/env node
// review_ou.mjs — 大小球：实际盘口低水方 vs 实际结果（跨7批）
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const batches = [
  [30, '0400_2', 30], [31, '0100_10', 31],
  [37, '1600_2', 37], [38, '1800_4', 38], [40, '1930_1', 39], [41, '2130_1', 40],
  [44, '0100_2', 43], [45, '0130_3', 44], [46, '0345_4', 45],
  [47, '1116_2100_3', 46], [48, '1116_2300_3', 47], [49, '1117_0000_3', 48],
  [50, '1117_0100_5', 49], [51, '1117_0345_5', 50],
];
const parseLine = (s) => {
  if (s.includes('/')) {
    const parts = s.split('/');
    return (parseFloat(parts[0]) + parseFloat(parts[1])) / 2;
  }
  return parseFloat(s);
};
// over 视角结算：1 大全赢 / 0.5 大赢半 / 0 走 / -0.5 大输半 / -1 大全输
const settleOne = (total, line) => total > line ? 1 : total === line ? 0 : -1;
const settleOU = (total, line) => {
  const q4 = Math.round(line * 4);
  if (q4 % 2 === 1) return (settleOne(total, line - 0.25) + settleOne(total, line + 0.25)) / 2;
  return settleOne(total, line);
};
let n = 0, lowOverHit = 0, lowOverN = 0, push = 0;
const detail = [];
const only = process.argv[2] ? process.argv[2].split(',').map(Number) : null;
for (const [b, mn, raw] of batches) {
  if (only && !only.includes(b)) continue;
  const meta = JSON.parse(readFileSync(`data/test/meta_${mn}.json`, 'utf8'));
  const results = JSON.parse(readFileSync(`data/test/results${b}.json`, 'utf8')).results;
  for (const m of meta.matches) {
    const [gh, ga] = results[m.no];
    if (typeof gh !== 'number' || typeof ga !== 'number') continue;
    const h = JSON.parse(readFileSync(join(`data/raw${raw}`, `${m.id}.handicap.json`), 'utf8'));
    const line = parseLine(h.ou);
    const over = parseFloat(h.ouOver), under = parseFloat(h.ouUnder);
    const total = gh + ga;
    const s = settleOU(total, line);
    n++;
    if (s === 0) push++;
    const lowSide = over < under ? '大' : over === under ? '均' : '小';
    // 低水方是否命中（赢/赢半算命中；输/输半算错；走盘剔除）
    let lowHit = null;
    if (s !== 0 && lowSide !== '均') {
      lowOverN++;
      if (lowSide === '大') lowHit = s > 0; else lowHit = s < 0;
      if (lowHit) lowOverHit++;
    }
    detail.push({ home: m.home, line, over, under, lowSide, total, s });
  }
}
const label = { 1: '大全赢', 0.5: '大赢半', 0: '走盘', [-0.5]: '大输半', [-1]: '大全输' };
console.log(`大小球总样本 n=${n} | 走盘 ${push}`);
console.log(`低水方命中 ${lowOverHit}/${lowOverN} = ${(lowOverHit / lowOverN * 100).toFixed(1)}%（剔除均水/走盘）`);
console.log('--- 逐场 ---');
for (const d of detail)
  console.log(`${d.home.padEnd(10)} 线${String(d.line).padEnd(5)} 大${d.over}/小${d.under} 低水${d.lowSide} | 实${d.total}球 ${label[d.s]}`);
