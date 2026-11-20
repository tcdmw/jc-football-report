#!/usr/bin/env node
// freeze_journal.mjs — 盘口「冻结」台账（只记录、不决策）
// 冻结定义：让球绝对值变化家数 ≤20% 且中位未变（样本 ≥8 家）。
// 语义：没有公司愿意为让球方加深/减弱，不等于定价充分。本台账只累计「冻结场次上盘结果」，
//       达到样本门槛前不参与方向、不改任何模型结论。
// 用法:
//   node tools/freeze_journal.mjs record <batchNo>      # 读 matchesN + raw(N-1) 判定并入库
//   node tools/freeze_journal.mjs settle <batchNo>      # 读 resultsN 结算上盘五档
//   node tools/freeze_journal.mjs report                # 汇总上盘赢/走/输与不输率
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const LIB = join(ROOT, 'data', 'freeze_journal.json');

function load() {
  if (!existsSync(LIB)) return [];
  try { return JSON.parse(readFileSync(LIB, 'utf8')); } catch { return []; }
}
function save(rows) { writeFileSync(LIB, JSON.stringify(rows, null, 1)); }
function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length; if (!n) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function detect(linePath) {
  const lines = JSON.parse(readFileSync(linePath, 'utf8')).lines || [];
  let retreat = 0, advance = 0, same = 0, flip = 0;
  const liveAbs = [], openAbs = [];
  for (const l of lines) {
    const o = l.openHc, v = l.liveHc;
    if (typeof o !== 'number' || typeof v !== 'number') continue;
    liveAbs.push(Math.abs(v)); openAbs.push(Math.abs(o));
    if (o !== 0 && v !== 0 && Math.sign(o) !== Math.sign(v)) { flip++; continue; }
    const oa = Math.abs(o), va = Math.abs(v);
    if (va < oa) retreat++; else if (va > oa) advance++; else same++;
  }
  const valid = retreat + advance + same;
  const medLiveAbs = median(liveAbs), medOpenAbs = median(openAbs);
  const changedRatio = valid ? (retreat + advance) / valid : 1;
  const frozen = valid >= 8 && changedRatio <= 0.2 && medLiveAbs === medOpenAbs;
  let neg = 0, pos = 0;
  for (const l of lines) { if (l.liveHc < 0) neg++; else if (l.liveHc > 0) pos++; }
  return {
    frozen, valid, retreat, advance, same, flip,
    medLiveAbs, medOpenAbs,
    flatPct: valid ? Math.round((same / valid) * 1000) / 10 : 0,
    favSide: neg > pos ? 'away' : (pos > neg ? 'home' : 'none'),
  };
}

const cmd = process.argv[2];
const batch = Number(process.argv[3]);

if (cmd === 'record') {
  const M = join(ROOT, 'data', 'out', `matches${batch}.json`);
  if (!existsSync(M)) { console.error('缺 ' + M); process.exit(2); }
  const matches = JSON.parse(readFileSync(M, 'utf8')).matches || [];
  const rawDir = join(ROOT, 'data', `raw${batch - 1}`);
  const rows = load().filter(r => r.batch !== batch);
  let hit = 0;
  for (const m of matches) {
    const lp = join(rawDir, `${m.id}.line.json`);
    if (!existsSync(lp)) continue;
    const d = detect(lp);
    if (!d.frozen) continue;
    hit++;
    rows.push({
      batch, no: m.no, id: m.id, home: m.home, away: m.away, hc: m.hc,
      favSide: d.favSide, favName: d.favSide === 'home' ? m.home : d.favSide === 'away' ? m.away : '平手',
      flatPct: d.flatPct, valid: d.valid, medLiveAbs: d.medLiveAbs, medOpenAbs: d.medOpenAbs,
      settled: false, settle: null, result: null,
    });
    console.log(`  + ${m.id} ${m.home} vs ${m.away} 冻结（${d.same}/${d.valid} 未动，中位 ${d.medOpenAbs}→${d.medLiveAbs}）让球方:${d.favSide}`);
  }
  save(rows);
  console.log(`[freeze] batch ${batch} 冻结 ${hit} 场，台账共 ${rows.length} 条`);
} else if (cmd === 'settle') {
  const R = join(ROOT, 'data', 'test', `results${batch}.json`);
  if (!existsSync(R)) { console.error('缺 ' + R); process.exit(2); }
  const results = JSON.parse(readFileSync(R, 'utf8')).results || {};
  const rows = load();
  for (const r of rows) {
    if (r.batch !== batch || r.settled) continue;
    const res = results[String(r.no)] || results[r.no];
    if (!Array.isArray(res)) continue;
    const [gh, ga] = res;
    const margin = gh - ga;              // 主队净胜球
    const net = margin - (r.hc || 0);    // 主队相对盘口
    let upper;                           // 让球方结果
    if (r.favSide === 'home') {
      upper = net > 0 ? 'win' : net === 0 ? 'push' : 'lose';
    } else if (r.favSide === 'away') {
      upper = net < 0 ? 'win' : net === 0 ? 'push' : 'lose';
    } else {
      upper = 'push';
    }
    r.settled = true; r.settle = upper; r.result = [gh, ga];
    console.log(`  = ${r.id} ${r.home} ${gh}-${ga} ${r.away} 让球方${r.favName} → ${upper}`);
  }
  save(rows);
  console.log(`[freeze] batch ${batch} 结算完成`);
} else if (cmd === 'report') {
  const rows = load();
  const done = rows.filter(r => r.settled);
  const win = done.filter(r => r.settle === 'win').length;
  const push = done.filter(r => r.settle === 'push').length;
  const lose = done.filter(r => r.settle === 'lose').length;
  console.log(`[freeze] 台账 ${rows.length} 条，已结算 ${done.length} 条`);
  if (done.length) {
    console.log(`  上盘 赢 ${win} / 走 ${push} / 输 ${lose}`);
    console.log(`  上盘不输率 ${((win + push) / done.length * 100).toFixed(1)}%`);
    console.log(`  上盘全赢率 ${(win / done.length * 100).toFixed(1)}%`);
    console.log(`  ${done.length < 15 ? '⚠ 样本 <15，只记录不决策' : '样本达标，可进入启用表评估'}`);
    for (const r of done) console.log(`   - 批${r.batch} ${r.home} ${r.result[0]}-${r.result[1]} ${r.away} 盘${r.hc} → ${r.settle}`);
  } else {
    console.log('  暂无已结算记录');
  }
} else {
  console.log('用法: node tools/freeze_journal.mjs record <batchNo> | settle <batchNo> | report');
  process.exit(2);
}
