#!/usr/bin/env node
// tools/verify.mjs — 交付前自检：数据完整性、页面比分与赛果基线交叉校验、让球分档、Brier
// 退出码：0 = 全部通过；3 = 存在阻断/不一致（阻断不出报告）
// 用法: node tools/verify.mjs [data/out/matches.json] [data/out/preds.json] [data/test/results.json]

import { readFileSync, existsSync } from 'node:fs';

const M = process.argv[2] || 'data/out/matches.json';
const P = process.argv[3] || 'data/out/preds.json';
const R = process.argv[4] || 'data/test/results_1146_11.json';

const matches = (JSON.parse(readFileSync(M, 'utf8')).matches) || [];
const preds = (JSON.parse(readFileSync(P, 'utf8')).preds) || [];
const results = (JSON.parse(readFileSync(R, 'utf8'))).results || {};

const fails = [];
const warns = [];
const pct = x => (x === null || x === undefined ? 'n/a' : `${(x * 100).toFixed(1)}%`);

// 1) 数据完整性
const st = {
  场次: matches.length,
  胜平负: matches.filter(m => m.spf).length,
  竞彩未开: matches.filter(m => m.jcNotOpen).length,
  总进球: matches.filter(m => m.zjq).length,
  让球: matches.filter(m => m.hc !== null && m.hc !== undefined).length,
  独立输入: matches.filter(m => m.team).length,
  页面比分: matches.filter(m => m.liveScore).length,
};
console.log('== 数据完整性 ==');
for (const [k, v] of Object.entries(st)) console.log(`  ${k.padEnd(6)} ${v}`);
if (st.独立输入 < st.场次) fails.push(`独立输入缺 ${st.场次 - st.独立输入} 场 → 按阻断规则不出报告`);
if (st.让球 < st.场次) warns.push(`让球缺 ${st.场次 - st.让球} 场`);
if (st.胜平负 + st.竞彩未开 < st.场次) fails.push(`胜平负覆盖不足：${st.胜平负}+未开${st.竞彩未开} < ${st.场次}`);

// 2) 页面比分 vs 赛果基线 交叉校验
console.log('== 页面比分 vs 赛果基线 ==');
let cmpOk = 0, cmpMiss = [];
for (const m of matches) {
  const r = results[m.no];
  if (!r || !m.liveScore) continue;
  if (r[0] === m.liveScore[0] && r[1] === m.liveScore[1]) cmpOk++;
  else cmpMiss.push(`${m.no} ${m.home}: 页面 ${m.liveScore.join(':')} vs 基线 ${r.join(':')}`);
}
console.log(`  一致 ${cmpOk} / ${matches.filter(m => results[m.no] && m.liveScore).length}`);
for (const x of cmpMiss) fails.push(`比分不一致 ${x}`);

// 3) 让球分档（业务口径：hc 主让为正）
const bucket = (hc) => {
  if (hc === 0) return '平手';
  if (hc > 0) return hc <= 0.75 ? '主让浅' : '主让深';
  return Math.abs(hc) <= 0.75 ? '客让浅' : '客让深';
};
const bk = {};
for (const m of matches) {
  if (typeof m.hc !== 'number' || !results[m.no]) continue;
  const b = bucket(m.hc);
  const [gh, ga] = results[m.no];
  const net = (gh - ga) - m.hc;
  bk[b] = bk[b] || { n: 0, 赢: 0, 走: 0, 输: 0 };
  bk[b].n++;
  if (net > 0) bk[b].赢++; else if (net === 0) bk[b].走++; else bk[b].输++;
}
console.log('== 让球分档（主队视角，11 场）==');
let tot = { n: 0, 赢: 0, 走: 0, 输: 0 };
for (const [b, v] of Object.entries(bk)) {
  console.log(`  ${b} ${v.n} 场 → 赢${v.赢} 走${v.走} 输${v.输}`);
  for (const k of Object.keys(tot)) tot[k] += v[k];
}
console.log(`  合计 ${tot.n} 场 → 主队赢盘 ${tot.赢} / 走 ${tot.走} / 输盘 ${tot.输}`);

// 4) Brier（模型 vs 市场）
function brier3(p, act) { const y = [0, 0, 0]; y[act] = 1; return [p[0], p[1], p[2]].reduce((s, v, i) => s + (v - y[i]) ** 2, 0); }
let sm = 0, nm = 0, sd = 0, nd = 0, hitM = 0, hitD = 0;
for (const p of preds) {
  const r = results[p.no]; if (!r) continue;
  const [gh, ga] = r;
  const act = gh > ga ? 0 : gh === ga ? 1 : 2;
  const mp = [p.probs.H, p.probs.D, p.probs.A];
  sm += brier3(mp, act); nm++;
  if (mp.indexOf(Math.max(...mp)) === act) hitM++;
  if (p.devig) { sd += brier3(p.devig, act); nd++; if (p.devig.indexOf(Math.max(...p.devig)) === act) hitD++; }
}
console.log('== 精度 ==');
console.log(`  模型：方向 ${hitM}/${nm} = ${pct(hitM / nm)} | Brier ${(sm / nm).toFixed(4)}`);
console.log(`  市场：方向 ${hitD}/${nd} = ${pct(hitD / nd)} | Brier ${nd ? (sd / nd).toFixed(4) : 'n/a'}`);

// 5) 阻断路径自检（team=null 场次必须被 analyze 拦下）
const blockedInPreds = (JSON.parse(readFileSync(P, 'utf8')).blocked) || [];
console.log('== 阻断条款 ==');
console.log(`  analyze 报告的阻断场次 ${blockedInPreds.length}`);
if (blockedInPreds.length) fails.push(...blockedInPreds.map(b => `BLOCKED ${b}`));

for (const w of warns) console.log(`  ! ${w}`);
for (const f of fails) console.log(`  ✗ ${f}`);
console.log(fails.length ? `[verify] FAIL — ${fails.length} 项问题` : '[verify] PASS — 全部检查通过');
process.exitCode = fails.length ? 3 : 0;
