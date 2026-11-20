#!/usr/bin/env node
/**
 * analog_backtest.mjs — 盘口同态检索的留一批回测
 *
 * 目的：在把「同态检索」当第四轨之前，先证明它到底有没有信息量。
 * 做法：把库里每一场带赛果的比赛当"目标"，在库中【排除该批】后找同盘口样本，
 *       只用同态样本的上盘不输率做方向判断，与实际结算比对。
 *
 * 用法: node tools/analog_backtest.mjs [--min 5] [--basis live|open]
 * 输出: 总体命中率 + 按盘口分层 + 按样本量分层
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LIB = join(ROOT, 'data', 'analog_lib.json');
if (!existsSync(LIB)) { console.error('先跑: node tools/analog_hc.mjs build'); process.exit(2); }

function settleInt(margin, line) {
  if (margin > line) return 1;
  if (margin === line) return 0;
  return -1;
}
function settleHandicap(margin, line) {
  const q4 = Math.round(line * 4);
  if (q4 % 2 === 1) {
    const lo = line - 0.25, hi = line + 0.25;
    return (settleInt(margin, lo) + settleInt(margin, hi)) / 2;
  }
  return settleInt(margin, line);
}

const argv = process.argv.slice(2);
let minN = 5, basis = 'live';
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--min') minN = parseInt(argv[++i], 10);
  else if (argv[i] === '--basis') basis = argv[++i];
}
const lib = JSON.parse(readFileSync(LIB, 'utf8'));
const pool = lib.entries.filter((e) => e.gh !== null);

const stats = { n: 0, hit: 0, up: 0, upHit: 0, down: 0, downHit: 0, noSample: 0, detail: [] };
const byLine = {}, byN = {};

for (const t of pool) {
  const hc = basis === 'open' ? t.hcOpen : t.hcLive;
  if (hc === null) continue;
  const line = Math.abs(hc);
  const favIsHome = hc >= 0;
  const peers = pool.filter((e) => {
    // 严格无前视：只允许用编号更早（时间更早）的批次做历史样本，避免用未来数据预测过去
    if (!(e.batch < t.batch)) return false;
    if (e.id === t.id) return false;
    const v = basis === 'open' ? e.hcOpen : e.hcLive;
    return v !== null && Math.abs(v - hc) < 1e-9;
  });
  if (peers.length < minN) { stats.noSample++; continue; }

  const s = peers.map((e) => {
    const m = favIsHome ? e.gh - e.ga : e.ga - e.gh;
    return settleHandicap(m, line);
  });
  const pud = (s.filter((x) => x >= 0).length) / s.length;   // 上盘不输率（含走盘）
  const predUp = pud > 0.5;                                   // 同态多数

  const actualS = settleHandicap(favIsHome ? t.gh - t.ga : t.ga - t.gh, line);
  const actualUp = actualS >= 0;                              // 走盘两边都算"不输"

  // 走盘一律算命中（双方都没输），避免把 0 当错误放大
  const hit = (predUp === actualUp) || (!predUp && !actualUp) || actualS === 0;
  stats.n++;
  if (hit) stats.hit++;
  if (predUp) { stats.up++; if (hit) stats.upHit++; } else { stats.down++; if (hit) stats.downHit++; }

  const k = line.toFixed(2);
  byLine[k] = byLine[k] || { n: 0, hit: 0, pud: 0 };
  byLine[k].n++; if (hit) byLine[k].hit++;
  byLine[k].pud += pud;

  const bucket = s.length <= 9 ? '5-9' : s.length <= 19 ? '10-19' : '>=20';
  byN[bucket] = byN[bucket] || { n: 0, hit: 0 };
  byN[bucket].n++; if (hit) byN[bucket].hit++;

  stats.detail.push({ batch: t.batch, lg: t.lg, home: t.home, away: t.away, sc: `${t.gh}-${t.ga}`,
    line, peers: s.length, pud: (pud * 100).toFixed(1), predUp, actualS, hit });
}

const pct = (a, b) => (b ? (a / b * 100).toFixed(1) + '%' : '-');
console.log(`\n[analog_backtest] basis=${basis} min=${minN} | 可回测 ${stats.n} 场 | 无样本 ${stats.noSample} 场`);
if (!stats.n) { console.log('无可用样本。'); process.exit(0); }

console.log(`\n=== 总体 ===`);
console.log(`同态方向命中 ${stats.hit}/${stats.n} = ${pct(stats.hit, stats.n)}`);
console.log(`  押上盘 ${stats.up} 场命中 ${pct(stats.upHit, stats.up)} | 押下盘 ${stats.down} 场命中 ${pct(stats.downHit, stats.down)}`);
console.log(`基准（全押上盘不输）: ${pct(pool.filter(e => {
  const hc = basis === 'open' ? e.hcOpen : e.hcLive; if (hc === null) return false;
  return settleHandicap((hc >= 0 ? e.gh - e.ga : e.ga - e.gh), Math.abs(hc)) >= 0;
}).length, pool.length)}`);

console.log(`\n=== 按盘口 ===`);
for (const [k, v] of Object.entries(byLine).sort((a, b) => parseFloat(a[0]) - parseFloat(b[0])))
  if (v.n >= 3) console.log(`  让球 ${k.padStart(6)} n=${String(v.n).padStart(3)} 命中 ${pct(v.hit, v.n)} 平均上盘不输率 ${(v.pud / v.n * 100).toFixed(1)}%`);

console.log(`\n=== 按同态样本量 ===`);
for (const [k, v] of Object.entries(byN)) console.log(`  样本 ${k.padEnd(6)} n=${String(v.n).padStart(3)} 命中 ${pct(v.hit, v.n)}`);

console.log(`\n=== 逐场（前 25）===`);
for (const d of stats.detail.slice(0, 25))
  console.log(`b${String(d.batch).padStart(2)} ${String(d.lg).padEnd(8)} ${String(d.home).slice(0, 8)} ${d.sc.padStart(4)} ${String(d.away).slice(0, 8)} | 盘${String(d.line).padEnd(5)} 样本${String(d.peers).padStart(2)} 上盘不输${d.pud}% 预测${d.predUp ? '上' : '下'} 实际${d.actualS} ${d.hit ? '✓' : '✗'}`);
