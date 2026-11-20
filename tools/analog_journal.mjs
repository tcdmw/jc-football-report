#!/usr/bin/env node
/**
 * analog_journal.mjs — 同态检索实习台账（每次跑批都记，不参与决策）
 *
 * 目的：在准确率/样本都还不够的阶段，让同态检索「每批都参与」但只做实习记录，
 *       把每一次的结论与赛后实际逐条存档，用真实成绩决定它何时转正。
 *
 * 用法:
 *   node tools/analog_journal.mjs record --batch 51        # 生成待结算记录 data/test/analog51.json
 *   node tools/analog_journal.mjs settle 51                # 有 results51 后结算，追加进台账
 *   node tools/analog_journal.mjs settle                   # 结算所有已具备 results 的批次
 *   node tools/analog_journal.mjs report                   # 实习成绩汇总 + 转正判定
 *
 * 台账: data/analog_journal.jsonl（一条一场，按 batch+no+id 去重）
 * 转正门槛（写死在 PROJECT_STANDARD，改动需人工确认）:
 *   累计已结算 >= 30 场，且整体命中率 >= 65%，且「已达门槛」子集命中率 >= 65%
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  matchTiers, pickTier, analyze, isEligible, tierOf, settleHandicap, num,
} from './analog_core.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const LIB_PATH = join(ROOT, 'data', 'analog_lib.json');
const OUT_DIR = join(ROOT, 'data', 'out');
const TEST_DIR = join(ROOT, 'data', 'test');
const JOURNAL = join(ROOT, 'data', 'analog_journal.jsonl');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

const PROJECT_STANDARD = { minSettled: 30, minHitRate: 65, eligibilityHitRate: 65, minSample: 5 };

function loadLib() {
  if (!existsSync(LIB_PATH)) { console.error('先跑: node tools/analog_hc.mjs build'); process.exit(2); }
  return readJson(LIB_PATH);
}

/* ---- record：生成待结算记录（赛前跑，用当时盘口） ---- */
function record(batch, opts = {}) {
  const mp = join(OUT_DIR, `matches${batch}.json`);
  if (!existsSync(mp)) { console.error(`缺 data/out/matches${batch}.json`); return null; }
  const m = readJson(mp);
  if (!m.source) { console.error(`matches${batch}.json 无 source 字段，无法定位 raw 目录`); return null; }
  const rawDir = resolve(ROOT, m.source);
  const lib = loadLib();
  // 严格无前视：只允许用「编号更早 = 时间更早」的批次做历史样本，
  // 否则就是用未来数据预测过去，成绩会虚高。
  const pool = lib.entries.filter((e) => e.gh !== null && e.batch < batch);
  const basis = opts.basis || 'live';
  const rows = [];

  for (const mm of m.matches || []) {
    const hp = join(rawDir, `${mm.id}.handicap.json`);
    if (!existsSync(hp)) { rows.push({ no: mm.no, id: String(mm.id), home: mm.home, away: mm.away, lg: mm.lg, error: '缺 handicap.json' }); continue; }
    const h = readJson(hp);
    const hc = num(h[basis]?.hc ?? h.hc);
    if (hc === null) { rows.push({ no: mm.no, id: String(mm.id), home: mm.home, away: mm.away, lg: mm.lg, error: '盘口为空' }); continue; }
    const target = { hc, hw: num(h[basis]?.hw), aw: num(h[basis]?.aw), src: h.source || '', lg: mm.lg };
    const line = Math.abs(hc);
    const favIsHome = hc >= 0;
    const { tiers } = matchTiers(target, pool, { basis, tol: opts.tol ?? 0.03 });
    const { chosen } = pickTier(tiers, opts.min ?? 5);
    const v = isEligible(line, chosen.arr.length, opts.min ?? 5);
    const sum = chosen.arr.length ? analyze(chosen.arr, { line, favIsHome, basis }) : null;
    rows.push({
      no: mm.no, id: String(mm.id), lg: mm.lg || '', kickoff: mm.kickoff || '',
      home: mm.home || '', away: mm.away || '',
      hc, line, favIsHome,
      hw: target.hw, aw: target.aw, src: target.src,
      tierUsed: chosen.key,
      peers: chosen.arr.length,
      sameHc: tiers[2].arr.length,
      layerCounts: { L1: tiers[0].arr.length, L2: tiers[1].arr.length, L3: tiers[2].arr.length },
      groupVerdict: v.group, groupHit: v.groupHit, groupN: v.groupN,
      eligible: v.eligible,
      pud: sum ? +(sum.pud * 100).toFixed(1) : null,
      pdown: sum ? +(sum.pdown * 100).toFixed(1) : null,
      wdl: sum ? sum.wdlDist : null,
      topSc: sum ? sum.topSc : null,
      avgGoal: sum ? +sum.avgGoal.toFixed(2) : null,
    });
  }

  const outPath = join(TEST_DIR, `analog${batch}.json`);
  writeFileSync(outPath, JSON.stringify({
    batch, source: m.source, rawDir: m.source, basis,
    generatedAt: new Date().toISOString(), rows,
  }, null, 1), 'utf8');
  const valid = rows.filter((r) => !r.error);
  const elig = valid.filter((r) => r.eligible);
  console.log(`[analog_journal] record batch${batch} -> data/test/analog${batch}.json`);
  console.log(`  场次 ${rows.length} | 可检索 ${valid.length} | 已达门槛 ${elig.length} | 未达门槛 ${valid.length - elig.length}`);
  for (const r of valid) {
    console.log(`  no${r.no} ${String(r.home).slice(0, 10)} vs ${String(r.away).slice(0, 10)} | 盘${r.line} 样本${r.peers} 上盘不输${r.pud ?? '-'}% ${r.eligible ? '[可达门槛]' : '[仅记录]'}`);
  }
  return outPath;
}

/* ---- settle：结算并追加台账 ---- */
function rawResults(batch) {
  const rp = join(TEST_DIR, `results${batch}.json`);
  if (!existsSync(rp)) return null;
  return readJson(rp).results || null;
}

function loadJournalKeys() {
  if (!existsSync(JOURNAL)) return new Set();
  const keys = new Set();
  for (const line of readFileSync(JOURNAL, 'utf8').split('\n')) {
    const s = line.trim(); if (!s) continue;
    try { const o = JSON.parse(s); keys.add(`${o.batch}|${o.no}|${o.id}`); } catch { }
  }
  return keys;
}

function settleBatch(batch, keys) {
  const ap = join(TEST_DIR, `analog${batch}.json`);
  if (!existsSync(ap)) return { batch, status: '无 record，跳过' };
  const rec = readJson(ap);
  const results = rawResults(batch);
  if (!results) return { batch, status: '缺 results，待赛后可结算' };
  let added = 0, skipped = 0, noResult = 0;
  const lines = [];
  for (const r of rec.rows) {
    if (r.error) continue;
    const k = `${batch}|${r.no}|${r.id}`;
    if (keys.has(k)) { skipped++; continue; }
    const res = results[r.no];
    if (!res) { noResult++; continue; }
    const [gh, ga] = res;
    if (!Number.isFinite(gh) || !Number.isFinite(ga)) { noResult++; continue; }
    const settle = settleHandicap(r.favIsHome ? gh - ga : ga - gh, r.line);
    // 同态预测：pud>50 押上盘，否则押下盘；judged 表示是否有样本支撑
    const judged = r.peers > 0 && r.pud !== null;
    const predUp = judged ? r.pud > 50 : null;
    const actualUp = settle >= 0;
    const hit = judged ? ((predUp === actualUp) || settle === 0) : null;
    lines.push(JSON.stringify({
      batch, no: r.no, id: r.id, lg: r.lg, kickoff: r.kickoff, home: r.home, away: r.away,
      line: r.line, favIsHome: r.favIsHome, peers: r.peers, tierUsed: r.tierUsed,
      groupVerdict: r.groupVerdict, eligible: r.eligible,
      pud: r.pud, pdown: r.pdown, predUp, gh, ga, settle, actualUp, hit,
    }));
    keys.add(k);
    added++;
  }
  if (lines.length) appendFileSync(JOURNAL, lines.join('\n') + '\n', 'utf8');
  return { batch, status: `新增 ${added} 场，重复 ${skipped}，缺赛果 ${noResult}` };
}

/* ---- report：实习成绩 ---- */
function report() {
  if (!existsSync(JOURNAL)) { console.log('台账为空，先 record + settle。'); return; }
  const rows = readFileSync(JOURNAL, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean)
    .map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
  const judged = rows.filter((r) => r.hit !== null);
  const pct = (a, b) => (b ? (a / b * 100).toFixed(1) + '%' : '-');

  console.log(`[analog_journal] 台账 ${rows.length} 条 | 有同态判断 ${judged.length} 场 | 批次 ${[...new Set(rows.map(r => r.batch))].length}`);
  const hit = judged.filter((r) => r.hit).length;
  console.log(`\n=== 实习总成绩 ===`);
  console.log(`同态方向命中 ${hit}/${judged.length} = ${pct(hit, judged.length)}`);

  const byLine = {};
  for (const r of judged) {
    const k = Number(r.line).toFixed(2);
    byLine[k] = byLine[k] || { n: 0, hit: 0 };
    byLine[k].n++; if (r.hit) byLine[k].hit++;
  }
  console.log(`\n=== 按盘口（实习实测 vs 启用表）===`);
  for (const [k, v] of Object.entries(byLine).sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))) {
    const g = tierOf(parseFloat(k));
    console.log(`  ${k.padStart(5)} 盘 n=${String(v.n).padStart(3)} 实习命中 ${pct(v.hit, v.n).padStart(6)} | 启用表 ${g.verdict}${g.hit === null ? '' : ' ' + g.hit + '%'}`);
  }

  // 门槛与盘口组判定一律按「当前」启用表实时重算，不用台账里存的旧值，
  // 这样启用表调整后报告立即反映新标准。
  const elig = judged.filter((r) => isEligible(r.line, r.peers, PROJECT_STANDARD.minSample).eligible);
  const unelig = judged.filter((r) => !isEligible(r.line, r.peers, PROJECT_STANDARD.minSample).eligible);
  console.log(`\n=== 按门槛 ===`);
  console.log(`  已达门槛 n=${elig.length} 命中 ${pct(elig.filter(r => r.hit).length, elig.length)}`);
  console.log(`  未达门槛 n=${unelig.length} 命中 ${pct(unelig.filter(r => r.hit).length, unelig.length)}（仅记录，不参与决策）`);

  const byVerdict = {};
  for (const r of judged) {
    const k = tierOf(r.line).verdict;              // 实时表，非台账旧值
    byVerdict[k] = byVerdict[k] || { n: 0, hit: 0 };
    byVerdict[k].n++; if (r.hit) byVerdict[k].hit++;
  }
  console.log(`\n=== 按盘口组判定 ===`);
  for (const [k, v] of Object.entries(byVerdict)) console.log(`  ${k.padEnd(10)} n=${String(v.n).padStart(3)} 命中 ${pct(v.hit, v.n)}`);

  const total = judged.length;
  const overallRate = total ? judged.filter(r => r.hit).length / total * 100 : 0;
  const eligRate = elig.length ? elig.filter(r => r.hit).length / elig.length * 100 : 0;
  const ok = total >= PROJECT_STANDARD.minSettled
    && overallRate >= PROJECT_STANDARD.minHitRate
    && eligRate >= PROJECT_STANDARD.eligibilityHitRate;
  console.log(`\n=== 转正判定 ===`);
  console.log(`  门槛: 已结算 >= ${PROJECT_STANDARD.minSettled} 场 | 整体命中 >= ${PROJECT_STANDARD.minHitRate}% | 达门槛子集命中 >= ${PROJECT_STANDARD.eligibilityHitRate}%`);
  console.log(`  当前: ${total} 场 | 整体 ${overallRate.toFixed(1)}% | 达门槛子集 ${eligRate.toFixed(1)}%`);
  console.log(`  结论: ${ok ? '达标 —— 可提交人工评审升级为正式复核' : '继续实习 —— 不参与决策'}`);
}

/* ---- md：生成可直接粘进报告的「同态实习」小节 ---- */
function mdSection(batch, optsWrite) {
  const REC = join(TEST_DIR, `analog${batch}.json`);
  if (!existsSync(REC)) { console.error(`缺 ${REC}，先跑: node tools/analog_journal.mjs record --batch ${batch}`); process.exit(2); }
  const rec = readJson(REC);
  const rows = (rec.rows || []).filter((r) => !r.error);
  const p = (v) => (v === null || v === undefined || Number.isNaN(v) ? '—' : v.toFixed(1) + '%');
  const out = [];
  out.push('## 同态实习（盘口同态检索 · 实习期，不参与决策）');
  out.push('');
  out.push('> 匹配口径：只用**编号更早批次**的历史场次按盘口检索（严禁前视）；水位维度不可用，只能「同盘口」。');
  out.push('> 启用表见 `tools/analog_core.mjs` 的 `TIER_GUIDE`，当前仅 0.50 盘为「启用」。');
  out.push('');
  out.push('| 序 | 比赛 | 盘口 | 层 | 同态样本 | 上盘不输 | 下盘不输 | 历史赛果分布 | 盘口组 | 结论 |');
  out.push('|---|---|---|---|---|---|---|---|---|---|');
  let eligCount = 0;
  const eligByLine = {};
  for (const r of rows) {
    const g = tierOf(r.line);
    const el = isEligible(r.line, r.peers, PROJECT_STANDARD.minSample);
    if (el.eligible) {
      eligCount++;
      const k = num(r.line).toFixed(2);
      eligByLine[k] = (eligByLine[k] || 0) + 1;
    }
    const w = r.wdl || {};
    const dist = `主${w['主'] || 0} / 平${w['平'] || 0} / 客${w['客'] || 0}`;
    const concl = el.eligible
      ? (g.verdict === '启用' ? '达门槛 · 可作降仓/加信心旁证' : '达门槛 · 仅记录')
      : '仅记录';
    out.push(`| ${r.no} | ${r.home} vs ${r.away} | ${num(r.line).toFixed(2)} | ${r.tierUsed} | ${r.peers} | ${p(r.pud)} | ${p(r.pdown)} | ${dist} | ${g.verdict} | ${concl} |`);
  }
  out.push('');
  out.push(`**本批结论**：${rows.length} 场中达门槛 ${eligCount} 场。`
    + (eligCount === 0
      ? '全部未达门槛，同态结论不进入任何判断。'
      : '达门槛场次仅作旁证，不得改写模型方向与大小球。'));
  // 同盘口重复提醒：同批多场同盘口会命中同一组历史样本，不是多次独立验证
  const dupLines = Object.entries(eligByLine).filter(([, v]) => v >= 2).sort((a, b) => b[1] - a[1]);
  for (const [line, cnt] of dupLines) {
    const sample = (rows.find((r) => num(r.line).toFixed(2) === line) || {}).peers;
    out.push('');
    out.push(`> ⚠️ **同盘口重复**：本批有 **${cnt} 场**同为 ${line} 盘，且共享同一组 ${sample} 个历史样本——`
      + `它们的「达门槛」是同一个结论的重复引用，**不是 ${cnt} 次独立验证**，不得据此叠加信心。`);
  }
  const text = out.join('\n');
  if (optsWrite) writeFileSync(join(TEST_DIR, `analog${batch}.md`), text + '\n', 'utf8');
  console.log(text);
}

/* ---- 入口 ---- */
const argv = process.argv.slice(2);
const cmd = argv[0];
const opts = { basis: 'live', min: 5, tol: 0.03 };
let batchArg = null;
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--batch') batchArg = parseInt(argv[++i], 10);
  else if (a === '--basis') opts.basis = argv[++i];
  else if (a === '--min') opts.min = parseInt(argv[++i], 10);
  else if (a === '--tol') opts.tol = parseFloat(argv[++i]);
  else if (a === '--out') opts.out = true;
  else if (/^\d+$/.test(a)) batchArg = parseInt(a, 10);
}

if (cmd === 'record') {
  if (!batchArg) { console.error('用法: node tools/analog_journal.mjs record --batch N'); process.exit(2); }
  record(batchArg, opts);
  process.exit(0);
} else if (cmd === 'settle') {
  const keys = loadJournalKeys();
  let targets;
  if (batchArg) targets = [batchArg];
  else {
    targets = readdirSync(TEST_DIR).filter((f) => /^analog\d+\.json/.test(f))
      .map((f) => parseInt(f.match(/^analog(\d+)\.json/)[1], 10)).sort((a, b) => a - b);
  }
  if (!targets.length) { console.log('没有待结算的 analog 记录。'); process.exit(0); }
  for (const b of targets) {
    const r = settleBatch(b, keys);
    console.log(`  batch${b}: ${r.status}`);
  }
  process.exit(0);
} else if (cmd === 'report') {
  report();
  process.exit(0);
} else if (cmd === 'md') {
  if (!batchArg) { console.error('用法: node tools/analog_journal.mjs md --batch N [--out]'); process.exit(2); }
  mdSection(batchArg, !!opts.out);
  process.exit(0);
} else {
  console.log('用法:');
  console.log('  node tools/analog_journal.mjs record --batch N    # 赛前记下同态结论');
  console.log('  node tools/analog_journal.mjs settle [N]          # 赛后结算进台账');
  console.log('  node tools/analog_journal.mjs report              # 实习成绩与转正判定');
  console.log('  node tools/analog_journal.mjs md --batch N [--out]  # 生成报告用的「同态实习」小节');
  process.exit(2);
}
