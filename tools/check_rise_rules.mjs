#!/usr/bin/env node
// check_rise_rules.mjs — 回溯「初盘→即时盘」形态与上盘结算的经验规则
// 规则取自用户口述（2026-11-20）：
//   A 0.75 → 1.0    多数打穿（上盘全赢）
//   B 0.75 未动     容易下盘
//   C 0.5  → 0.75   容易下盘
//   D 0.25 未动     容易下盘
//   E 升到 0.5      多数打穿
// 口径：让球用多公司中位（符号=让球方），结算用「即时盘」绝对值 + 让球方净胜球；
//       亚盘四档按 0.25=拆0/0.5、0.5=单、0.75=拆0.5/1.0、1.0=单 结算，输出 全赢/赢半/走/输半/全输。
// 用法: node tools/check_rise_rules.mjs [--detail]
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const DETAIL = process.argv.includes('--detail');

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length; if (!n) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
// 返回 +1 全赢 / +0.5 赢半 / 0 走 / -0.5 输半 / -1 全输
function settle(hcAbs, m) {
  const whole = Math.floor(hcAbs + 1e-9);
  const frac = +(hcAbs - whole).toFixed(2);
  let parts;
  if (frac === 0.25) parts = [whole, whole + 0.5];
  else if (frac === 0.75) parts = [whole + 0.5, whole + 1];
  else if (frac === 0.5) parts = [whole + 0.5];
  else parts = [whole];
  let sum = 0;
  for (const h of parts) {
    const d = m - h;
    sum += d > 0 ? 1 : d === 0 ? 0 : -1;
  }
  return sum / parts.length;
}
const RESULT_NAME = { 1: '全赢', 0.5: '赢半', 0: '走水', '-0.5': '输半', '-1': '全输' };

const rows = [];
const dist = {};
let allPairs = 0, signFlip = 0;
const raws = readdirSync(join(ROOT, 'data')).filter(d => /^raw\d+$/.test(d))
  .sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)));
for (const d of raws) {
  const b = Number(d.slice(3)) + 1;
  const RP = join(ROOT, 'data', 'test', `results${b}.json`);
  if (!existsSync(RP)) continue;
  const results = JSON.parse(readFileSync(RP, 'utf8')).results || {};
  const MP = join(ROOT, 'data', 'out', `matches${b}.json`);
  if (!existsSync(MP)) continue;
  const matches = JSON.parse(readFileSync(MP, 'utf8')).matches || [];
  for (const mt of matches) {
    const LP = join(ROOT, 'data', d, `${mt.id}.line.json`);
    if (!existsSync(LP)) continue;
    const res = results[String(mt.no)] || results[mt.no];
    if (!Array.isArray(res)) continue;
    const lines = JSON.parse(readFileSync(LP, 'utf8')).lines || [];
    let neg = 0, pos = 0;
    for (const l of lines) { if (l.liveHc < 0) neg++; else if (l.liveHc > 0) pos++; }
    const favSide = neg > pos ? 'away' : pos > neg ? 'home' : 'none';
    if (favSide === 'none') continue;
    const medOpen = median(lines.map(l => l.openHc));
    const medLive = median(lines.map(l => l.liveHc));
    allPairs++;
    const openA0 = Math.abs(medOpen), liveA0 = Math.abs(medLive);
    const flipped = Math.sign(medOpen) !== Math.sign(medLive);
    if (flipped) signFlip++;
    const dkey = `${openA0}→${liveA0}${flipped ? '(易主)' : ''}`;
    dist[dkey] = (dist[dkey] || 0) + 1;
    if (Math.sign(medOpen) !== Math.sign(medLive)) continue; // 跨 0 易主，不属本规则族
    const openA = Math.abs(medOpen), liveA = Math.abs(medLive);
    let grp = null;
    if (openA === 0.75 && liveA === 1) grp = 'A 0.75→1.0';
    else if (openA === 0.75 && liveA === 0.75) grp = 'B 0.75未动';
    else if (openA === 0.5 && liveA === 0.75) grp = 'C 0.5→0.75';
    else if (openA === 0.25 && liveA === 0.25) grp = 'D 0.25未动';
    else if (openA <= 0.25 && liveA === 0.5) grp = 'E 升到0.5';
    else if (openA === 0.75 && liveA === 0.5) grp = 'Z 0.75→0.5(对照)';
    else continue;
    const [gh, ga] = res;
    const margin = favSide === 'home' ? gh - ga : ga - gh;
    const s = settle(liveA, margin);
    rows.push({
      batch: b, no: mt.no, id: mt.id, home: mt.home, away: mt.away,
      fav: favSide === 'home' ? mt.home : mt.away,
      open: medOpen, live: medLive, grp, score: `${gh}-${ga}`, margin, s,
      result: RESULT_NAME[String(s)] || String(s),
    });
  }
}

const groups = {};
for (const r of rows) {
  if (!groups[r.grp]) groups[r.grp] = { n: 0, win: 0, halfWin: 0, push: 0, halfLose: 0, lose: 0 };
  const g = groups[r.grp];
  g.n++;
  if (r.s === 1) g.win++;
  else if (r.s === 0.5) g.halfWin++;
  else if (r.s === 0) g.push++;
  else if (r.s === -0.5) g.halfLose++;
  else g.lose++;
}
console.log(`[rise] 可用配对样本 ${rows.length} 场（有 line.json + 真实比分，且让球方向未易主）\n`);
const head = ['形态', '样本', '全赢', '赢半', '走水', '输半', '全输', '全赢率', '上盘不输率'];
console.log(head.join(' | '));
for (const k of Object.keys(groups).sort()) {
  const g = groups[k];
  const wr = ((g.win / g.n) * 100).toFixed(0);
  const nr = (((g.win + g.halfWin + g.push) / g.n) * 100).toFixed(0);
  console.log([k, g.n, g.win, g.halfWin, g.push, g.halfLose, g.lose, wr + '%', nr + '%'].join(' | '));
}
if (DETAIL) {
  console.log('\n逐场明细：');
  for (const r of rows) {
    console.log(`  批${r.batch} ${r.home} vs ${r.away} 盘 ${r.open}→${r.live} 比分${r.score} 让球方${r.fav} 净胜${r.margin} → ${r.result}`);
  }
}
if (process.argv.includes('--dist')) {
  console.log(`\n[dist] 有 line+比分 的配对共 ${allPairs} 场，其中让球易主 ${signFlip} 场`);
  const sorted = Object.entries(dist).sort((a, b) => b[1] - a[1]);
  for (const [k, v] of sorted) console.log(`  ${k}: ${v} 场`);
}
