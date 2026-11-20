#!/usr/bin/env node
// check_line.mjs — 亚盘初盘→即时退盘/升盘方向统计，并与双轨模型方向比对、给告警。
// 不替代模型，只把“盘口实时变化”显式化，避免只看即时盘/单一模型。
// 两级判定：
//   冲突(HDA) — 多数退盘且即时让球已弱到平/半(≤0.25)，让球方赢球信心动摇，与模型胜负方向冲突
//   退盘(rq)  — 多数退盘但即时仍让半球(≥0.5)，胜负方向仍倾向让球方，仅提示让球/深盘风险，不翻转 HDA
// 用法: node tools/check_line.mjs <批次目录> <meta.json> <preds.json> <engine.json>
// 退出码: 0 无 HDA 冲突（rq 退盘仅提示）；4 存在 HDA 冲突；2 参数/文件错误
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [DIR, META, PREDS, ENGINE, MATCHES] = process.argv.slice(2);
if (!DIR || !META || !PREDS || !ENGINE) {
  console.log('用法: node tools/check_line.mjs <批次目录> <meta.json> <preds.json> <engine.json> [matches.json]');
  process.exit(2);
}

const items = JSON.parse(readFileSync(META, 'utf8')).matches;
const preds = JSON.parse(readFileSync(PREDS, 'utf8')).preds;
const eng = JSON.parse(readFileSync(ENGINE, 'utf8')).preds;
// 可选第 5 参：matches.json，传入则做“盘口×基本面”交叉验证；不传则只做盘口统计（向后兼容）
let matchItems = null;
if (MATCHES && existsSync(MATCHES)) {
  matchItems = JSON.parse(readFileSync(MATCHES, 'utf8')).matches;
}

const sideName = { home: '主', away: '客', neutral: '中性', none: '平手' };

const pct = x => (x * 100).toFixed(1);
function argmax3(h, d, a) {
  if (h >= d && h >= a) return 'H';
  if (a >= d && a >= h) return 'A';
  return 'D';
}
function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length;
  if (!n) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
const dirLabel = { H: '主', D: '平', A: '客' };

// 基本面方向：仅用 matches 里结构化、可复核字段（整体实力/近期状态/体能），不做文本 NLP。
// 必发资金（真实成交量占比）单独输出，不并入实力评分；伤停文本只标注存在性。
function analyzeFundamentals(match) {
  const t = match.team || {};
  const ov = t.overall || {};
  const form = t.form || {};
  const lg = t.leagueOf || {};
  const rest = match.restDays || {};
  const dims = [];

  // 维度1 整体实力（同联赛、积分差≥4 且排名差≥2 才出方向）
  let v1 = 'neutral', d1 = '无 overall';
  if (ov.home && ov.away && lg.home === lg.away) {
    const dPts = ov.home.points - ov.away.points;
    const dRank = ov.away.rank - ov.home.rank; // 正=主队排名靠前
    if (dPts >= 4 && dRank >= 2) v1 = 'home';
    else if (dPts <= -4 && dRank <= -2) v1 = 'away';
    d1 = `积分差${dPts >= 0 ? '+' : ''}${dPts} 排名差${dRank >= 0 ? '+' : ''}${dRank}`;
  }
  dims.push({ key: '实力', vote: v1, detail: d1 });

  // 维度2 近期状态（近 6 场净胜球差≥3 才出方向）
  let v2 = 'neutral', d2 = '无 form';
  if (form.home && form.away) {
    const hGD = form.home.gf - form.home.ga;
    const aGD = form.away.gf - form.away.ga;
    const d = hGD - aGD;
    if (d >= 3) v2 = 'home';
    else if (d <= -3) v2 = 'away';
    d2 = `近6净胜球 主${hGD >= 0 ? '+' : ''}${hGD}/客${aGD >= 0 ? '+' : ''}${aGD} 差${d >= 0 ? '+' : ''}${d}`;
  }
  dims.push({ key: '状态', vote: v2, detail: d2 });

  // 维度3 体能（休息天数差≥3 才出方向）
  let v3 = 'neutral', d3 = '无 rest';
  if (typeof rest.home === 'number' && typeof rest.away === 'number') {
    const d = rest.home - rest.away;
    if (d >= 3) v3 = 'home';
    else if (d <= -3) v3 = 'away';
    d3 = `休息 主${rest.home}/客${rest.away} 差${d >= 0 ? '+' : ''}${d}`;
  }
  dims.push({ key: '体能', vote: v3, detail: d3 });

  const homeVotes = dims.filter(x => x.vote === 'home').length;
  const awayVotes = dims.filter(x => x.vote === 'away').length;
  let fundSide = 'neutral';
  if (homeVotes > awayVotes) fundSide = 'home';
  else if (awayVotes > homeVotes) fundSide = 'away';

  // 必发资金方向（独立，成交占比差≥10 个百分点）
  const flow = { vote: 'neutral', detail: '无必发数据' };
  const dqd = match.dqdIntel;
  if (dqd && Array.isArray(dqd.betfair)) {
    const h = dqd.betfair.find(b => b.option === '主胜');
    const a = dqd.betfair.find(b => b.option === '客胜');
    if (h && a) {
      const hr = Number(h.ratio), ar = Number(a.ratio), d = hr - ar;
      if (d >= 10) flow.vote = 'home';
      else if (d <= -10) flow.vote = 'away';
      flow.detail = `必发成交占比 主${hr}%/客${ar}% 差${d >= 0 ? '+' : ''}${d}`;
    }
  }
  const hasInjury = !!(dqd && Array.isArray(dqd.injuries) && dqd.injuries.length);

  return { dims, fundSide, flow, hasInjury, available: !!(ov.home && ov.away) };
}

// 盘口方向 + 基本面方向 → 一致性标记
function judgeConsistency(fund, lineDir, advanceMajority, retreatMajority) {
  if (!fund.available) return { mark: '数据不足', note: '缺 overall，无法交叉，仅看盘口' };
  if (lineDir === 'none') {
    return {
      mark: '盘口退平',
      note: fund.fundSide === 'neutral'
        ? '盘口已退到平手，基本面亦无明显方向'
        : `盘口退到平手，基本面方向偏“${sideName[fund.fundSide]}”，以基本面/即时盘为准`
    };
  }
  if (fund.fundSide === 'neutral') return { mark: '中性', note: '基本面差距小，盘口无法被证实或证伪' };
  if (fund.fundSide === lineDir) {
    return {
      mark: '一致',
      note: advanceMajority ? '升盘有基本面实力支撑，信号相对可信（仍不追深盘）'
        : retreatMajority ? '退盘与基本面弱化方向一致'
        : '盘口方向与基本面一致'
    };
  }
  // 背离
  if (advanceMajority) {
    return { mark: '背离', note: `升盘强化“${sideName[lineDir]}”但基本面偏“${sideName[fund.fundSide]}”，资金热/诱盘嫌疑，不追` };
  }
  if (retreatMajority) {
    return { mark: '背离', note: `退盘弱化“${sideName[lineDir]}”但基本面偏“${sideName[fund.fundSide]}”，或为资金热下盘，该方未必不行` };
  }
  return { mark: '背离', note: `盘口方向“${sideName[lineDir]}”与基本面“${sideName[fund.fundSide]}”不一致` };
}

let conflicts = 0;
let skipped = 0;
console.log(`[check_line] 目录 ${DIR}，${items.length} 场 — 亚盘实时变化核对`);

for (const it of items) {
  const linePath = join(DIR, `${it.id}.line.json`);
  if (!existsSync(linePath)) {
    skipped++;
    console.log(`  · ${it.id} ${it.home || ''}: 无 line.json（旧批次未采集，跳过）`);
    continue;
  }
  const lines = JSON.parse(readFileSync(linePath, 'utf8')).lines;

  // 让球方：按各公司即时 hc 符号多数决定（负=主队受让=客队让球）
  let neg = 0, pos = 0;
  for (const l of lines) {
    if (l.liveHc < 0) neg++;
    else if (l.liveHc > 0) pos++;
  }
  const favSide = neg > pos ? 'away' : (pos > neg ? 'home' : 'none');
  const favName = favSide === 'away' ? (it.away || '客队')
    : favSide === 'home' ? (it.home || '主队') : '平手';

  // 按让球绝对值统计退盘/升盘；跨 0 易主单独计数
  let retreat = 0, advance = 0, same = 0, flip = 0;
  const liveAbs = [];
  const openAbs = [];
  for (const l of lines) {
    const o = l.openHc, v = l.liveHc;
    liveAbs.push(Math.abs(v));
    openAbs.push(Math.abs(o));
    if (o !== 0 && v !== 0 && Math.sign(o) !== Math.sign(v)) { flip++; continue; }
    const oa = Math.abs(o), va = Math.abs(v);
    if (va < oa) retreat++;
    else if (va > oa) advance++;
    else same++;
  }
  const valid = retreat + advance + same;
  const medLiveAbs = median(liveAbs);
  const medOpenAbs = median(openAbs);
  // 弱端：即时让球已退到平/半(≤0.25)的公司数
  const weakCount = liveAbs.filter(x => x <= 0.25).length;
  const retreatRatio = valid ? retreat / valid : 0;
  const advanceRatio = valid ? advance / valid : 0;
  const flatRatio = valid ? same / valid : 0;
  const changedRatio = valid ? (retreat + advance) / valid : 1;
  // 盘口冻结：变化家数 ≤20% 且绝对值中位未变（至少 8 家样本）。
  // 语义：没有公司愿意为让球方加深/减弱，不等于“定价充分”，需与基本面/战意交叉判读。
  const frozen = valid >= 8 && changedRatio <= 0.2 && medLiveAbs === medOpenAbs;

  // 双轨模型方向
  const pred = preds.find(p => p.no === it.no);
  const e = eng.find(p => p.no === it.no);
  const anaDir = pred && pred.probs ? argmax3(pred.probs.H, pred.probs.D, pred.probs.A) : null;
  const engDir = e ? argmax3(e.engine.H, e.engine.D, e.engine.A) : null;

  // 让球方对应的模型方向（客队让球→A；主队让球→H）
  const favModelDir = favSide === 'away' ? 'A' : favSide === 'home' ? 'H' : null;
  const modelOnFav = !!favModelDir && (anaDir === favModelDir || engDir === favModelDir);
  const retreatMajority = valid > 0 && retreat > valid / 2;
  const advanceMajority = valid > 0 && advance > valid / 2;

  // 两级判定
  let flag = '正常';
  let level = null;
  // HDA 冲突：退盘压倒性一致、几乎无反向升盘、整体让球下移到半球且有公司退到平/半
  const hdaConflict = modelOnFav &&
    retreatRatio >= (2 / 3) && advanceRatio <= 0.1 &&
    medLiveAbs < medOpenAbs && medLiveAbs <= 0.5 && weakCount >= 1;
  if (hdaConflict) {
    flag = '冲突(HDA)';
    level = 'hda';
    conflicts++;
  } else if (modelOnFav && retreatMajority) {
    flag = '退盘(rq)';
    level = 'rq';
  } else if (modelOnFav && advanceMajority) {
    flag = '强化';
  } else if (frozen) {
    flag = '冻结';
  }

  const anaTxt = pred && pred.probs ? `${pct(pred.probs.H)}/${pct(pred.probs.D)}/${pct(pred.probs.A)}` : 'n/a';
  const engTxt = e && e.engine ? `${pct(e.engine.H)}/${pct(e.engine.D)}/${pct(e.engine.A)}` : 'n/a';
  console.log(
    `  ${level === 'hda' ? '⚠' : '✓'} ${it.id} ${it.home || ''} vs ${it.away || ''} ` +
    `[让球方:${favName}] 退${retreat}/升${advance}/平${same}` +
    (flip ? `/易主${flip}` : '') +
    ` 即时让球中位${medLiveAbs}(初${medOpenAbs}) 弱端${weakCount}家 | 模型 ana${dirLabel[anaDir] || '-'} eng${dirLabel[engDir] || '-'} ` +
    `(HDA ana${anaTxt} eng${engTxt}) — ${flag}`);

  if (level === 'hda') {
    console.log(
      `      ⚠ 模型押让球方“${favName}”，但 ${valid} 家中 ${retreat} 家退盘（≥2/3）、${weakCount} 家即时让球已弱到平/半（≤0.25），` +
      `胜负信心动摇：建议下调/取消该 HDA 方向，倾向受让方不败，以盘口变化为准。`);
  } else if (level === 'rq') {
    console.log(
      `      · 让球方虽退盘，但即时仍让 ${medLiveAbs}（半球以上），胜负方向仍倾向“${favName}”；` +
      `退盘主要影响让球，深盘不追，不翻转 HDA。`);
  } else if (frozen) {
    console.log(
      `      · ${valid} 家中 ${same} 家让球未动（${Math.round(flatRatio * 100)}%），盘口冻结：` +
      `没有公司愿意为“${favName}”加深让球，不等于定价充分，须与基本面/战意交叉判读，不因冻结加信心。`);
  }

  // 盘口×基本面交叉验证（仅当传入 matches.json）
  if (matchItems) {
    const match = matchItems.find(x => x.no === it.no);
    if (match) {
      // 盘口方向：多数退盘且已弱到平/半 → 视为退到平手；否则让球方即盘口方向
      let lineDir = favSide;
      if (retreatMajority && medLiveAbs <= 0.25) lineDir = 'none';
      const fund = analyzeFundamentals(match);
      const cj = judgeConsistency(fund, lineDir, advanceMajority, retreatMajority);
      console.log(`      ◇ 基本面×盘口：${cj.mark}（实力方向:${sideName[fund.fundSide]}；盘口方向:${sideName[lineDir]}）`);
      const dimTxt = fund.dims.map(d => `${d.key}${sideName[d.vote]}`).join(' ');
      console.log(`          ${dimTxt} | 资金:${sideName[fund.flow.vote]}${fund.hasInjury ? ' | 有伤停情报' : ''}`);
      if (fund.flow.detail !== '无必发数据') console.log(`          ${fund.flow.detail}`);
      console.log(`          ${cj.note}`);
    }
  }
}

if (skipped) console.log(`[check_line] ${skipped} 场因无 line.json 跳过（向后兼容）`);
if (conflicts) {
  console.log(`[check_line] 发现 ${conflicts} 场 HDA 方向与多数退盘冲突（已退到平/半），请复核。`);
  process.exit(4);
}
console.log('[check_line] 无 HDA 冲突；退盘(rq)场仅作让球风险提示。');
process.exit(0);
