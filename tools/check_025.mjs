// check_025.mjs — 0.25（平/半）盘下盘与平局水位热度统计（通用，无硬编码）
// 用法:
//   node tools/check_025.mjs <raw目录> <meta.json> [results.json]
//   - 无 results：赛前模式，列出 0.25 盘场次与平局赔率/概率，提示防下盘
//   - 有 results：复盘模式，结合真实比分判定上下盘并统计定价 vs 实际
// 退出码: 0 正常；2 读取/字段异常
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [rawDir, metaPath, resultsPath] = process.argv.slice(2);
if (!rawDir || !metaPath) {
  console.error('用法: node tools/check_025.mjs <raw目录> <meta.json> [results.json]');
  process.exit(2);
}

let exitCode = 0;
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const meta = readJson(metaPath);
const results = resultsPath && existsSync(resultsPath) ? readJson(resultsPath).results : null;

const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const rows = [];

for (const m of meta.matches) {
  const hp = join(rawDir, `${m.id}.handicap.json`);
  if (!existsSync(hp)) continue;
  const h = readJson(hp);
  if (Math.abs(h.hc) !== 0.25) continue;

  const favIsHome = h.hc > 0;            // 让球方（上盘）
  let res = null;
  if (results && results[m.no]) {
    const [gh, ga] = results[m.no];
    res = gh === ga ? 'D' : (gh > ga ? 'H' : 'A');
  }
  const favWon = res === null ? null : ((favIsHome && res === 'H') || (!favIsHome && res === 'A'));

  const xp = join(rawDir, `${m.id}.1x2.json`);
  let x12 = null;
  if (existsSync(xp)) x12 = readJson(xp);
  else exitCode = 2;

  rows.push({ no: m.no, id: m.id, home: m.home, away: m.away, favIsHome, res, favWon, x12 });
}

if (!rows.length) {
  console.log(`[check_025] ${rawDir} 无临场让0.25场次。`);
  process.exit(0);
}

const mode = results ? '复盘模式（含真实比分）' : '赛前模式（无比分，防下盘）';
console.log(`[check_025] ${mode} | 0.25盘 ${rows.length} 场 | 源 ${rawDir}`);

if (!results) {
  console.log('\nno 对阵（让球方） | 即时和赔率 和概率% | 提示');
  for (const r of rows) {
    const la = r.x12 && r.x12.liveAvg;
    console.log(
      r.no, `${r.home} vs ${r.away}（让${r.favIsHome ? '主' : '客'}）`,
      la ? `| 和 ${la.d} 和概率 ${la.pd}%` : '| 无1x2数据',
      la ? (la.pd <= 28 ? '| 平局热度低，防下盘/平' : '') : '');
  }
  console.log('\n提示: 0.25盘历史小样本下下盘占比高，平局赔率高/热度低时优先防受让方不败。');
  process.exit(exitCode);
}

// 复盘统计
const lower = rows.filter(r => !r.favWon);
const upper = rows.filter(r => r.favWon);
const draws = rows.filter(r => r.res === 'D');
const lowerDraw = lower.filter(r => r.res === 'D');
const withX = rows.filter(r => r.x12 && r.x12.liveAvg);
const n = rows.length;

console.log('\n=== 上下盘 ===');
console.log('上盘', upper.length, '| 下盘', lower.length,
  `= ${(lower.length / n * 100).toFixed(1)}% | 实际平局 ${draws.length} = ${(draws.length / n * 100).toFixed(1)}%`);
console.log('下盘中平局', lowerDraw.length, '、让球方直接输', lower.length - lowerDraw.length);

if (withX.length) {
  console.log('\n=== 市场即时平均（归一化概率%）===');
  console.log('主', mean(withX.map(r => r.x12.liveAvg.ph)).toFixed(1),
    '| 和', mean(withX.map(r => r.x12.liveAvg.pd)).toFixed(1),
    '| 客', mean(withX.map(r => r.x12.liveAvg.pa)).toFixed(1));
  console.log('和赔率均值', mean(withX.map(r => r.x12.liveAvg.d)).toFixed(2),
    '范围', Math.min(...withX.map(r => r.x12.liveAvg.d)), '-', Math.max(...withX.map(r => r.x12.liveAvg.d)));
  console.log('\n=== 定价 vs 实际 ===');
  console.log('市场平局概率', mean(withX.map(r => r.x12.liveAvg.pd)).toFixed(1) + '%',
    'vs 实际平局率', (draws.length / n * 100).toFixed(1) + '%');
}

console.log('\n=== 逐场明细 ===');
for (const r of rows) {
  const la = r.x12 && r.x12.liveAvg;
  console.log(
    r.no, `${r.home} ${r.res}`, r.favWon ? '上盘' : '下盘',
    la ? `| 和 ${la.d} (${la.pd}%)` : '| 无1x2');
}
if (exitCode === 2) console.log('\n注意: 部分场次缺 1x2.json（旧批次未采集欧赔），已跳过该项。');
process.exit(exitCode);
