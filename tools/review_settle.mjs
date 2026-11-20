#!/usr/bin/env node
// review_settle.mjs — 跨7批让球结算档位聚合（复用 check_handicap 结算逻辑）
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const batches = [
  [30, '0400_2', 30], [31, '0100_10', 31],
  [37, '1600_2', 37], [38, '1800_4', 38], [40, '1930_1', 39], [41, '2130_1', 40],
  [44, '0100_2', 43], [45, '0130_3', 44], [46, '0345_4', 45],
  [47, '1116_2100_3', 46], [48, '1116_2300_3', 47], [49, '1117_0000_3', 48],
  [50, '1117_0100_5', 49], [51, '1117_0345_5', 50],
];
const settleInt = (margin, line) => margin > line ? 1 : margin === line ? 0 : -1;
const settleHandicap = (margin, line) => {
  const q4 = Math.round(line * 4);
  if (q4 % 2 === 1) return (settleInt(margin, line - 0.25) + settleInt(margin, line + 0.25)) / 2;
  return settleInt(margin, line);
};
const label = { 1: '上盘全赢', 0.5: '上盘赢半', 0: '走盘', [-0.5]: '上盘输半', [-1]: '下盘全赢' };
const cnt = { 1: 0, 0.5: 0, 0: 0, [-0.5]: 0, [-1]: 0 };
const detail = [];
const only = process.argv[2] ? process.argv[2].split(',').map(Number) : null;
for (const [b, mn, raw] of batches) {
  if (only && !only.includes(b)) continue;
  const meta = JSON.parse(readFileSync(`data/test/meta_${mn}.json`, 'utf8'));
  const results = JSON.parse(readFileSync(`data/test/results${b}.json`, 'utf8')).results;
  for (const m of meta.matches) {
    const [gh, ga] = results[m.no];
    if (!Array.isArray([gh, ga])) continue;
    if (typeof gh !== 'number' || typeof ga !== 'number') continue;
    const h = JSON.parse(readFileSync(join(`data/raw${raw}`, `${m.id}.handicap.json`), 'utf8'));
    const line = Math.abs(h.hc);
    const favIsHome = h.hc >= 0;
    const margin = favIsHome ? gh - ga : ga - gh;
    const s = settleHandicap(margin, line);
    cnt[s]++;
    detail.push({ home: m.home, line, s });
  }
}
const n = detail.length;
console.log(`让球结算总样本 n=${n}`);
for (const s of [1, 0.5, 0, -0.5, -1])
  console.log(`${label[s]} ${cnt[s]} (${(cnt[s] / n * 100).toFixed(1)}%)`);
const upWin = cnt[1] + cnt[0.5];
const lowNotAllLose = cnt[0.5] + cnt[0] + cnt[-0.5] + cnt[-1] - cnt[-1]; // 下盘视角不全输
const under = cnt[-1] + cnt[-0.5];
console.log(`\n上盘(让球方)赢(全赢+赢半) ${upWin} = ${(upWin / n * 100).toFixed(1)}%`);
console.log(`下盘(受让方)不全输 ${cnt[-1] + cnt[-0.5] + cnt[0]} = ${((cnt[-1] + cnt[-0.5] + cnt[0]) / n * 100).toFixed(1)}%`);
console.log('--- 逐场 ---');
for (const d of detail) console.log(`${d.home.padEnd(10)} 让${String(d.line).padEnd(5)} ${label[d.s]}`);
