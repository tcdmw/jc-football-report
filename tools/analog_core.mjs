/**
 * analog_core.mjs — 盘口同态检索的共享核心（匹配 + 五档结算 + 盘口组启用表）
 * 被 tools/analog_hc.mjs（打印）与 tools/analog_journal.mjs（实习台账）共同引用，
 * 保证两处口径不分叉。改动结算或启用表只改这里。
 */

/* ---- 盘口组启用表 ---- */
/**
 * 来源：2026-11-18 两套**无前视**口径（只用编号更早的批次做样本）——
 *   ① analog_backtest.mjs --min 5：47 场可回测，总体 63.8%
 *   ② analog_journal.mjs report：107 场判断，总体 59.8%（含样本<5 的场次）
 * 两口径冲突时取**保守值**（较低的一侧），宁可不启用也不虚高。
 *   0.50 两口径一致（journal 70.6% / backtest 77.8%）→ 启用
 *   0.75 冲突（53.8% / 80.0%）→ 降为观察
 *   0.25 略高于 50（63.3% / 54.5%）→ 观察
 *   0.00、1.00 均低于 50 → 禁用
 * 判定：命中 >= 65% 且 n >= 5 → 启用；< 50% → 禁用；其余观察；n < 5 → 样本不足。
 * 库增长后必须重跑上面两条命令并更新此表，禁止沿用旧值。
 */
export const TIER_GUIDE = {
  '0.00': { n: 9, hit: 44.4, verdict: '禁用' },
  '0.25': { n: 30, hit: 54.5, verdict: '观察' },
  '0.50': { n: 17, hit: 70.6, verdict: '启用' },
  '0.75': { n: 13, hit: 53.8, verdict: '观察' },
  '1.00': { n: 12, hit: 41.7, verdict: '禁用' },
  '1.25': { n: 8, hit: 50.0, verdict: '观察' },
  '1.50': { n: 3, hit: 66.7, verdict: '样本不足' },
  '1.75': { n: 8, hit: 62.5, verdict: '观察' },
  '2.00': { n: 5, hit: 80.0, verdict: '样本不足' },
};

export const tierOf = (line) =>
  TIER_GUIDE[Number(line).toFixed(2)] || { n: 0, hit: null, verdict: '样本不足' };

/** 达标门槛：盘口组启用 + 本场同态样本 >= minSample */
export function isEligible(line, sampleN, minSample = 5) {
  const t = tierOf(line);
  const groupOk = t.verdict === '启用' || t.verdict === '启用(样本薄)';
  return { eligible: groupOk && sampleN >= minSample, group: t.verdict, groupHit: t.hit, groupN: t.n };
}

/* ---- 结算（与 check_handicap.mjs 同口径，上盘视角）---- */
export function settleInt(margin, line) {
  if (margin > line) return 1;
  if (margin === line) return 0;
  return -1;
}
export function settleHandicap(margin, line) {
  const q4 = Math.round(line * 4);
  if (q4 % 2 === 1) {
    const lo = line - 0.25, hi = line + 0.25;
    return (settleInt(margin, lo) + settleInt(margin, hi)) / 2;
  }
  return settleInt(margin, line);
}
export function settleSize(total, line) {
  const q4 = Math.round(line * 4);
  if (q4 % 2 === 1) {
    const lo = line - 0.25, hi = line + 0.25;
    return (settleInt(total, lo) + settleInt(total, hi)) / 2;
  }
  return settleInt(total, line);
}
export const LABEL = { 1: '全赢', 0.5: '赢半', 0: '走盘', '-0.5': '输半', '-1': '全输' };
export const labelOf = (s) => LABEL[String(s)] || String(s);

export const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v).replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
export const parseLine = (s) => {
  if (s === null || s === undefined || s === '') return null;
  const parts = String(s).split('/').map((x) => parseFloat(x));
  if (!parts.length || parts.some((x) => !Number.isFinite(x))) return null;
  return parts.reduce((a, b) => a + b, 0) / parts.length;
};

/* ---- 匹配：三层降级 ---- */
/**
 * @param target {hc, hw, aw, src}  目标场（basis 已由调用方取好）
 * @param pool   历史库条目数组（已过滤掉无赛果与自身批次）
 * @param opts   {basis, tol, league, sameSrc, lg}
 */
export function matchTiers(target, pool, opts = {}) {
  const { basis = 'live', tol = 0.03, league = false, sameSrc = false } = opts;
  const hc = target.hc;
  const lgOf = (e) => e.lg;
  const byBasis = (e, k) => (basis === 'open' ? e[`hcOpen`] : e[`hcLive`]);
  const hwOf = (e) => (basis === 'open' ? e.hwOpen : e.hwLive);
  const awOf = (e) => (basis === 'open' ? e.awOpen : e.awLive);

  const sameHcAll = pool.filter((e) => {
    const v = byBasis(e);
    return v !== null && Math.abs(v - hc) < 1e-9;
  });
  const lgF = (arr) => (league && target.lg ? arr.filter((e) => lgOf(e) === target.lg) : arr);
  const srcF = (arr) => (sameSrc && target.src ? arr.filter((e) => e.src === target.src) : arr);

  const l1 = lgF(srcF(sameHcAll.filter((e) => {
    const hwL = hwOf(e), awL = awOf(e);
    return hwL !== null && awL !== null && target.hw !== null && target.aw !== null
      && Math.abs(hwL - target.hw) <= tol && Math.abs(awL - target.aw) <= tol;
  })));
  const l2 = lgF(srcF(sameHcAll.filter((e) => {
    const hwL = hwOf(e);
    return hwL !== null && target.hw !== null && Math.abs(hwL - target.hw) <= tol + 0.02;
  })));
  const l3 = lgF(sameHcAll);

  const tiers = [
    { key: 'L1', name: `L1 盘口+双水位±${tol}${sameSrc ? '+同公司' : ''}`, arr: l1 },
    { key: 'L2', name: `L2 盘口+主水位±${(tol + 0.02).toFixed(2)}${sameSrc ? '+同公司' : ''}`, arr: l2 },
    { key: 'L3', name: 'L3 仅盘口相同', arr: l3 },
  ];
  return { tiers, sameHcAll };
}

/** 按 min 选层：优先 L1→L2→L3 中第一个达标的；都不达标取样本最多的那层 */
export function pickTier(tiers, min = 5) {
  for (const t of tiers) if (t.arr.length >= min) return { chosen: t, reached: true };
  let best = tiers[0];
  for (const t of tiers) if (t.arr.length > best.arr.length) best = t;
  return { chosen: best, reached: best.arr.length >= min };
}

/* ---- 汇总统计 ---- */
export function analyze(peers, { line, favIsHome, basis = 'live' }) {
  const settles = peers.map((e) => {
    const margin = favIsHome ? e.gh - e.ga : e.ga - e.gh;
    const s = settleHandicap(margin, line);
    const tot = e.gh + e.ga;
    const ouL = basis === 'open' ? e.ouOpen : e.ouLive;
    const ouS = ouL === null ? null : settleSize(tot, ouL);
    return { e, s, tot, ouL, ouS, margin };
  });
  const n = settles.length;
  const cnt = (arr, key) => arr.reduce((a, x) => { const k = String(x[key]); a[k] = (a[k] || 0) + 1; return a; }, {});
  const dist = cnt(settles, 's');
  const pud = n ? (settles.filter((x) => x.s >= 0).length) / n : null;     // 上盘不输（含走盘）
  const pdown = n ? (settles.filter((x) => x.s <= 0).length) / n : null;   // 下盘不输（含走盘）
  const wdl = settles.map((x) => (x.e.gh > x.e.ga ? '主' : x.e.gh === x.e.ga ? '平' : '客'));
  const wdlDist = wdl.reduce((a, k) => { a[k] = (a[k] || 0) + 1; return a; }, {});
  const scDist = {};
  for (const x of settles) { const k = `${x.e.gh}-${x.e.ga}`; scDist[k] = (scDist[k] || 0) + 1; }
  const topSc = Object.entries(scDist).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const withOu = settles.filter((x) => x.ouS !== null);
  const ouDist = withOu.length ? cnt(withOu, 'ouS') : null;
  const avgGoal = n ? settles.reduce((s, x) => s + x.tot, 0) / n : null;
  return { n, settles, dist, pud, pdown, wdlDist, topSc, avgGoal, ouDist, ouN: withOu.length };
}
