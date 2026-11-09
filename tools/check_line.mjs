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

const [DIR, META, PREDS, ENGINE] = process.argv.slice(2);
if (!DIR || !META || !PREDS || !ENGINE) {
  console.log('用法: node tools/check_line.mjs <批次目录> <meta.json> <preds.json> <engine.json>');
  process.exit(2);
}

const items = JSON.parse(readFileSync(META, 'utf8')).matches;
const preds = JSON.parse(readFileSync(PREDS, 'utf8')).preds;
const eng = JSON.parse(readFileSync(ENGINE, 'utf8')).preds;

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

  // 双轨模型方向
  const pred = preds.find(p => p.no === it.no);
  const e = eng.find(p => p.no === it.no);
  const anaDir = pred ? argmax3(pred.probs.H, pred.probs.D, pred.probs.A) : null;
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
  }

  const anaTxt = pred ? `${pct(pred.probs.H)}/${pct(pred.probs.D)}/${pct(pred.probs.A)}` : 'n/a';
  const engTxt = e ? `${pct(e.engine.H)}/${pct(e.engine.D)}/${pct(e.engine.A)}` : 'n/a';
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
  }
}

if (skipped) console.log(`[check_line] ${skipped} 场因无 line.json 跳过（向后兼容）`);
if (conflicts) {
  console.log(`[check_line] 发现 ${conflicts} 场 HDA 方向与多数退盘冲突（已退到平/半），请复核。`);
  process.exit(4);
}
console.log('[check_line] 无 HDA 冲突；退盘(rq)场仅作让球风险提示。');
process.exit(0);
