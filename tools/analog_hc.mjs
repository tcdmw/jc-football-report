#!/usr/bin/env node
/**
 * analog_hc.mjs — 盘口同态检索（实习期工具，只作复核/记录，不参与决策）
 *
 * 方法来自 football_frontend-main（500 网扩展）的「历史相同盘口相同水位」匹配思路；
 * 库为本地自建（matches 批次 + raw 的 handicap + results 批次），不依赖任何外部服务。
 * 匹配与结算口径统一在 tools/analog_core.mjs。
 *
 * 用法:
 *   node tools/analog_hc.mjs build                 # 重建历史库 data/analog_lib.json
 *   node tools/analog_hc.mjs stat                  # 库规模与盘口分桶
 *   node tools/analog_hc.mjs <raw目录> <meta.json>  # 对指定批次做同态检索
 *
 * 选项:
 *   --tol 0.03        水位容差（默认 0.03）
 *   --basis live|open 用即时盘(默认)或初盘匹配
 *   --min 5           最小样本，低于此值标「样本不足」
 *   --league          只匹配同联赛
 *   --same-src        只匹配同一盘口来源公司（水位可比性略好）
 *   --self-batch N    排除该批次自身
 *   --json            输出结构化 JSON（供 analog_journal 使用）
 * 退出码: 0 正常；2 参数或数据异常
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  TIER_GUIDE, tierOf, isEligible, matchTiers, pickTier, analyze,
  labelOf, num, parseLine,
} from './analog_core.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const LIB_PATH = join(ROOT, 'data', 'analog_lib.json');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

/* ---- 建库 ---- */
function build() {
  const outDir = join(ROOT, 'data', 'out');
  const testDir = join(ROOT, 'data', 'test');
  const files = readdirSync(outDir).filter((f) => /^matches\d+\.json$/.test(f));
  const entries = [];
  const skipped = { noHandicap: 0, noResult: 0, noSource: 0 };
  for (const f of files) {
    const batch = parseInt(f.match(/^matches(\d+)\.json$/)[1], 10);
    let m;
    try { m = readJson(join(outDir, f)); } catch { continue; }
    const src = m.source;
    if (!src) { skipped.noSource += m.matches?.length || 0; continue; }
    const rawDir = resolve(ROOT, src);
    const rp = join(testDir, `results${batch}.json`);
    const results = existsSync(rp) ? (readJson(rp).results || {}) : null;
    for (const mm of m.matches || []) {
      const hp = join(rawDir, `${mm.id}.handicap.json`);
      if (!existsSync(hp)) { skipped.noHandicap++; continue; }
      let h;
      try { h = readJson(hp); } catch { skipped.noHandicap++; continue; }
      const entry = {
        batch, no: mm.no, id: String(mm.id), lg: mm.lg || '', kickoff: mm.kickoff || '',
        home: mm.home || '', away: mm.away || '',
        hcOpen: num(h.open?.hc ?? h.hc), hcLive: num(h.live?.hc ?? h.hc),
        hwOpen: num(h.open?.hw), awOpen: num(h.open?.aw),
        hwLive: num(h.live?.hw), awLive: num(h.live?.aw),
        ouOpen: parseLine(h.open?.ouLine), ouLive: parseLine(h.live?.ouLine ?? h.ou),
        overLive: num(h.live?.over ?? h.ouOver), underLive: num(h.live?.under ?? h.ouUnder),
        src: h.source || '', gh: null, ga: null,
      };
      if (results && results[mm.no]) {
        const [gh, ga] = results[mm.no];
        if (Number.isFinite(gh) && Number.isFinite(ga)) { entry.gh = gh; entry.ga = ga; }
        else skipped.noResult++;
      } else skipped.noResult++;
      entries.push(entry);
    }
  }
  const withResult = entries.filter((e) => e.gh !== null);
  writeFileSync(LIB_PATH, JSON.stringify({
    builtAt: new Date().toISOString(),
    count: entries.length, withResult: withResult.length, skipped, entries,
  }), 'utf8');
  console.log('[analog_hc] 库已重建 -> data/analog_lib.json');
  console.log(`总条目 ${entries.length} | 含赛果 ${withResult.length} | 跳过(无盘口) ${skipped.noHandicap} | 跳过(无赛果/未完赛) ${skipped.noResult}`);
  return { entries, withResult, skipped };
}

function loadLib() {
  if (!existsSync(LIB_PATH)) {
    console.error('历史库不存在，请先执行: node tools/analog_hc.mjs build');
    process.exit(2);
  }
  return readJson(LIB_PATH);
}

/* ---- 统计 ---- */
function stat() {
  const lib = loadLib();
  const w = lib.entries.filter((e) => e.gh !== null);
  console.log(`[analog_hc] 库 builtAt ${lib.builtAt}`);
  console.log(`条目 ${lib.count} | 含赛果 ${lib.withResult} | 批次 ${[...new Set(lib.entries.map(e => e.batch))].length}`);
  const byHc = {};
  for (const e of w) { const k = e.hcLive === null ? 'NA' : e.hcLive.toFixed(2); byHc[k] = (byHc[k] || 0) + 1; }
  console.log(`\n=== 即时盘口分桶（含有赛果）===`);
  for (const [k, v] of Object.entries(byHc).sort((a, b) => parseFloat(a[0]) - parseFloat(b[0])) {
    const g = tierOf(parseFloat(k));
    console.log(`  让球 ${k.padStart(6)} : ${String(v).padStart(4)} 场 | 盘口组 ${g.verdict}${g.hit === null ? '' : ` ${g.hit}%`}`);
  }
  console.log(`\n水位可用：即时双水位 ${w.filter(e => e.hwLive !== null && e.awLive !== null).length} | 初盘双水位 ${w.filter(e => e.hwOpen !== null && e.awOpen !== null).length}`);
}

/* ---- 检索 ---- */
function query(rawDirArg, metaArg, opts) {
  const lib = loadLib();
  const rawDir = resolve(ROOT, rawDirArg);
  const meta = readJson(resolve(ROOT, metaArg));
  const basis = opts.basis === 'open' ? 'open' : 'live';
  const pool = lib.entries.filter((e) => e.gh !== null && !(opts.selfBatch && e.batch === opts.selfBatch));
  const out = [];

  for (const m of meta.matches) {
    const hp = join(rawDir, `${m.id}.handicap.json`);
    if (!existsSync(hp)) {
      out.push({ no: m.no, id: String(m.id), home: m.home, away: m.away, lg: m.lg, error: '缺 handicap.json' });
      if (!opts.json) console.log(`\nno${m.no} ${m.home} vs ${m.away} | 缺 handicap.json，跳过`);
      continue;
    }
    const h = readJson(hp);
    const hc = num(h[basis]?.hc ?? h.hc);
    if (hc === null) {
      out.push({ no: m.no, id: String(m.id), home: m.home, error: '盘口为空' });
      if (!opts.json) console.log(`\nno${m.no} ${m.home} vs ${m.away} | 盘口为空，跳过`);
      continue;
    }
    const target = { hc, hw: num(h[basis]?.hw), aw: num(h[basis]?.aw), src: h.source || '', lg: m.lg };
    const line = Math.abs(hc);
    const favIsHome = hc >= 0;
    const { tiers } = matchTiers(target, pool, opts);
    const { chosen } = pickTier(tiers, opts.min);
    const verdict = isEligible(line, chosen.arr.length, opts.min);
    const sum = chosen.arr.length ? analyze(chosen.arr, { line, favIsHome, basis }) : null;

    const row = {
      batch: opts.selfBatch ?? null,
      no: m.no, id: String(m.id), lg: m.lg || '', kickoff: m.kickoff || '',
      home: m.home || '', away: m.away || '',
      hc, line, favIsHome,
      hw: target.hw, aw: target.aw,
      tierUsed: chosen.key, tierName: chosen.name,
      peers: chosen.arr.length, sameHc: tiers[2].arr.length,
      layerCounts: { L1: tiers[0].arr.length, L2: tiers[1].arr.length, L3: tiers[2].arr.length },
      groupVerdict: verdict.group, groupHit: verdict.groupHit, groupN: verdict.groupN,
      eligible: verdict.eligible,
      pud: sum ? +(sum.pud * 100).toFixed(1) : null,
      pdown: sum ? +(sum.pdown * 100).toFixed(1) : null,
      wdl: sum ? sum.wdlDist : null,
      topSc: sum ? sum.topSc : null,
      avgGoal: sum ? +sum.avgGoal.toFixed(2) : null,
      peerList: chosen.arr.slice(0, 12).map((e) => ({
        batch: e.batch, lg: e.lg, home: e.home, away: e.away, gh: e.gh, ga: e.ga,
        hw: basis === 'open' ? e.hwOpen : e.hwLive, aw: basis === 'open' ? e.awOpen : e.awLive,
      })),
    };
    out.push(row);
    if (opts.json) continue;

    /* ---- 人读输出 ---- */
    console.log(`\n${'='.repeat(66)}`);
    console.log(`no${m.no} ${m.home} vs ${m.away}  [${m.lg}] ${m.kickoff || ''}`);
    console.log(`目标盘口 ${hc}（${favIsHome ? '主让' : '客让'}）| ${basis === 'open' ? '初盘' : '即时'}水位 主${target.hw ?? '-'} / 客${target.aw ?? '-'} | 大小 ${h[basis]?.ouLine ?? h.ou ?? '-'}`);
    console.log(`同态样本：${chosen.name} -> ${chosen.arr.length} 场（库内同盘口 ${tiers[2].arr.length} 场）`);
    console.log(`  分层: ${tiers.map(t => `${t.key}=${t.arr.length}`).join(' | ')}`);
    if (tiers[0].arr.length === 0 && tiers[1].arr.length === 0) {
      console.log('  注: 水位层为 0 —— 库内每场只采一家公司一个时点，水位不可比；当前仅盘口维度可用。');
    }
    console.log(`  盘口组: ${line.toFixed(2)} 盘 | 历史命中 ${verdict.groupHit === null ? '-' : verdict.groupHit + '%'}（n=${verdict.groupN}）→ ${verdict.group}`);
    console.log(`  实习资格: ${verdict.eligible ? '已达门槛（可作复核参考）' : '未达门槛（仅记录，不影响决策）'}`);
    if (verdict.group === '禁用') console.log('  ⚠ 该盘口组回测命中率低于 50% 基准，本场同态结论**不采纳**。');
    console.log('  注: 同盘口场次共享同一组历史，不具备个体区分力；仅让球方向经过回测，大小球/比分未验证。');

    if (!sum || !sum.n) { console.log('  → 库内无相同盘口样本。'); continue; }

    const d = sum.dist, n = sum.n;
    console.log(`\n  【让球·上盘视角】n=${n}`);
    console.log(`    全赢 ${d['1'] || 0} (${((d['1'] || 0) / n * 100).toFixed(1)}%) | 赢半 ${d['0.5'] || 0} (${((d['0.5'] || 0) / n * 100).toFixed(1)}%) | 走盘 ${d['0'] || 0} (${((d['0'] || 0) / n * 100).toFixed(1)}%) | 输半 ${d['-0.5'] || 0} (${((d['-0.5'] || 0) / n * 100).toFixed(1)}%) | 全输 ${d['-1'] || 0} (${((d['-1'] || 0) / n * 100).toFixed(1)}%)`);
    console.log(`    上盘不输 ${(sum.pud * 100).toFixed(1)}% | 下盘不输 ${(sum.pdown * 100).toFixed(1)}%`);
    if (sum.ouDist) {
      console.log(`  【大小球·大球视角】n=${sum.ouN} | 大 ${sum.ouDist['1'] || 0} | 走 ${sum.ouDist['0'] || 0} | 小 ${sum.ouDist['-1'] || 0}`);
    }
    console.log(`  【胜平负】主 ${sum.wdlDist['主'] || 0} | 平 ${sum.wdlDist['平'] || 0} | 客 ${sum.wdlDist['客'] || 0}`);
    console.log(`  【比分前三】${sum.topSc.map(([k, v]) => `${k}(${v}场,${(v / n * 100).toFixed(0)}%)`).join('  ')} | 场均 ${sum.avgGoal.toFixed(2)}`);
    console.log(`\n  明细（最多 12 条）:`);
    for (const e of row.peerList) {
      console.log(`    b${String(e.batch).padStart(2)} ${String(e.lg).padEnd(8)} ${String(e.home).slice(0, 8)} ${String(e.gh)}-${String(e.ga)} ${String(e.away).slice(0, 8)} | 水位 ${e.hw ?? '-'}/${e.aw ?? '-'}`);
    }
    if (chosen.arr.length > 12) console.log(`    …… 另有 ${chosen.arr.length - 12} 场`);
  }
  if (opts.json) {
    const payload = { rawDir: rawDirArg, meta: metaArg, basis, tol: opts.tol, min: opts.min, generatedAt: new Date().toISOString(), rows: out };
    if (opts.jsonPath) { writeFileSync(resolve(ROOT, opts.jsonPath), JSON.stringify(payload), 'utf8'); console.log(`[analog_hc] JSON 已写入 ${opts.jsonPath}`); }
    else console.log(JSON.stringify(payload));
  }
  return out;
}

/* ---- 入口 ---- */
const argv = process.argv.slice(2);
const opts = { tol: 0.03, min: 5, basis: 'live', league: false, sameSrc: false, selfBatch: null, json: false, jsonPath: null };
const pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--tol') opts.tol = parseFloat(argv[++i]);
  else if (a === '--min') opts.min = parseInt(argv[++i], 10);
  else if (a === '--basis') opts.basis = argv[++i];
  else if (a === '--league') opts.league = true;
  else if (a === '--same-src') opts.sameSrc = true;
  else if (a === '--self-batch') opts.selfBatch = parseInt(argv[++i], 10);
  else if (a === '--json') opts.json = true;
  else if (a === '--json-out') { opts.json = true; opts.jsonPath = argv[++i]; }
  else pos.push(a);
}

const cmd = pos[0];
if (cmd === 'build') { build(); process.exit(0); }
else if (cmd === 'stat') { stat(); process.exit(0); }
else if (pos.length >= 2) { query(pos[0], pos[1], opts); process.exit(0); }
else {
  console.log('用法:');
  console.log('  node tools/analog_hc.mjs build                    重建历史库');
  console.log('  node tools/analog_hc.mjs stat                     库规模与分桶');
  console.log('  node tools/analog_hc.mjs <raw目录> <meta.json>     同态检索');
  console.log('选项: --tol 0.03 --basis live|open --min 5 --league --same-src --self-batch N --json --json-out <path>');
  process.exit(2);
}
