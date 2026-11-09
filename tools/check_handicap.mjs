// check_handicap.mjs — 通用亚盘让球结算与下盘/水位热度统计（无硬编码，支持任意盘口）
// 用法:
//   node tools/check_handicap.mjs <raw目录> <meta.json> [results.json] [目标盘口]
//   - 目标盘口可选，如 0.25 / 0.75；不传则统计该批全部让球场次
//   - 无 results：赛前模式，列盘口/让球方/平局赔率热度并提示
//   - 有 results：复盘模式，按结算档位统计并对比市场定价 vs 实际
// 结算（上盘视角）：1 全赢 / 0.5 赢半 / 0 走盘 / -0.5 输半 / -1 全输
// 退出码: 0 正常；2 读取/字段异常
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [rawDir, metaPath, resultsPath, onlyLine] = process.argv.slice(2);
if (!rawDir || !metaPath) {
  console.error('用法: node tools/check_handicap.mjs <raw目录> <meta.json> [results.json] [目标盘口]');
  process.exit(2);
}

let exitCode = 0;
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const meta = readJson(metaPath);
const results = resultsPath && existsSync(resultsPath) ? readJson(resultsPath).results : null;
const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);

// 整数/半球单盘：让球方净胜 margin 对盘口 line
function settleInt(margin, line) {
  if (margin > line) return 1;
  if (margin === line) return 0;
  return -1;
}
// 通用结算：quarter 盘(.25/.75)拆成相邻两个半盘各一半，其余为单盘
function settleHandicap(margin, line) {
  const q4 = Math.round(line * 4);
  if (q4 % 2 === 1) {                       // x.25 或 x.75
    const lo = line - 0.25, hi = line + 0.25;
    return (settleInt(margin, lo) + settleInt(margin, hi)) / 2;
  }
  return settleInt(margin, line);
}
const labelOf = (s) =>
  ({ 1: '上盘全赢', 0.5: '上盘赢半', 0: '走盘', [-0.5]: '上盘输半', [-1]: '下盘全赢' }[s]);

const rows = [];
for (const m of meta.matches) {
  const hp = join(rawDir, `${m.id}.handicap.json`);
  if (!existsSync(hp)) continue;
  const h = readJson(hp);
  const line = Math.abs(h.hc);
  if (onlyLine && line !== parseFloat(onlyLine)) continue;

  const isLevel = h.hc === 0;               // 平手盘无让球方
  const favIsHome = h.hc >= 0;              // 平手盘按主队视角，避免符号反转
  let settle = null;
  if (results && results[m.no]) {
    const [gh, ga] = results[m.no];
    const margin = favIsHome ? gh - ga : ga - gh;
    settle = settleHandicap(margin, line);
  }
  const xp = join(rawDir, `${m.id}.1x2.json`);
  let x12 = null;
  if (existsSync(xp)) x12 = readJson(xp);
  else exitCode = 2;

  rows.push({ no: m.no, id: m.id, home: m.home, away: m.away, line, isLevel, favIsHome, settle, x12 });
}

if (!rows.length) {
  console.log(`[check_handicap] ${rawDir} 无符合条件的让球场次${onlyLine ? '（盘口 ' + onlyLine + '）' : ''}。`);
  process.exit(0);
}

const n = rows.length;
const mode = results ? '复盘模式（含真实比分）' : '赛前模式（无比分）';
console.log(`[check_handicap] ${mode} | ${n} 场 | 源 ${rawDir}${onlyLine ? ' | 盘口 ' + onlyLine : ''}`);

if (!results) {
  console.log('\nno 盘口 对阵（让球方） | 即时和赔率 和概率% | 提示');
  for (const r of rows) {
    const la = r.x12 && r.x12.liveAvg;
    console.log(
      r.no, r.line, `${r.home} vs ${r.away}（让${r.favIsHome ? '主' : '客'}）`,
      la ? `| 和 ${la.d} 和概率 ${la.pd}%` : '| 无1x2',
      la && la.pd <= 28 ? '| 平局热度低，防下盘/平' : '');
  }
  console.log('\n提示: 复合盘(.25/.75)有赢半/输半中间态，让球方打穿需净胜足够，平局热度低时优先受让方或观望。');
  process.exit(exitCode);
}

// 复盘：按结算档位分桶
const buckets = [1, 0.5, 0, -0.5, -1].map((s) => ({ s, items: rows.filter(r => r.settle === s) }));
console.log('\n=== 结算档位（上盘视角）===');
for (const b of buckets) {
  if (b.items.length) console.log(labelOf(b.s), b.items.length, `(${(b.items.length / n * 100).toFixed(1)}%)`);
}
const upFull = rows.filter(r => r.settle === 1);
const lowFull = rows.filter(r => r.settle === -1);
const lowNotAllLose = rows.filter(r => r.settle > -1);   // 下盘不全输
console.log('\n上盘全赢率', (upFull.length / n * 100).toFixed(1) + '%',
  '| 下盘全赢率', (lowFull.length / n * 100).toFixed(1) + '%',
  '| 下盘不全输', (lowNotAllLose.length / n * 100).toFixed(1) + '%');

const withX = rows.filter(r => r.x12 && r.x12.liveAvg);
if (withX.length) {
  console.log('\n=== 市场即时平均（归一化概率%）===');
  console.log('让球方平均概率', mean(withX.map(r => (r.favIsHome ? r.x12.liveAvg.ph : r.x12.liveAvg.pa))).toFixed(1),
    '| 平局平均概率', mean(withX.map(r => r.x12.liveAvg.pd)).toFixed(1),
    '| 平局平均赔率', mean(withX.map(r => r.x12.liveAvg.d)).toFixed(2));
  console.log('市场让球方概率 vs 实际上盘全赢率',
    mean(withX.map(r => (r.favIsHome ? r.x12.liveAvg.ph : r.x12.liveAvg.pa))).toFixed(1) + '%',
    'vs', (upFull.length / n * 100).toFixed(1) + '%');
}

console.log('\n=== 逐场明细 ===');
for (const r of rows) {
  const la = r.x12 && r.x12.liveAvg;
  console.log(r.no, '盘口', r.line, (r.isLevel ? '平手盘 ' : '') + labelOf(r.settle),
    la ? `| 和 ${la.d} (${la.pd}%)` : '| 无1x2', `| ${r.id}`);
}
if (exitCode === 2) console.log('\n注意: 部分场次缺 1x2.json（旧批次未采集欧赔），已跳过该项。');
process.exit(exitCode);
