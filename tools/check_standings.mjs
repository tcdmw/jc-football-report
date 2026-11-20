// check_standings.mjs — 杯赛小组出线/升降级形势 + 战意（确定性规则，数字全部来自杯赛积分段）
// 用法: node tools/check_standings.mjs <rawDir> <meta.json> <out.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [RAW, META, OUT] = process.argv.slice(2);

// 各级别 4 队小组的名次 -> 规则分区
const ZONE = {
  A: {
    1: ['quarterfinal', '前二·1/4决赛区'],
    2: ['quarterfinal', '前二·1/4决赛区'],
    3: ['third_risk', '第三·留A/附加赛（需跨组比较）'],
    4: ['relegation_risk', '第四·附加赛/直接降级（需跨组比较）'],
  },
  B: {
    1: ['promotion', '头名·直接升级A'],
    2: ['playoff_ab', '第二·A/B附加赛'],
    3: ['safe', '第三·留B（安全）'],
    4: ['playoff_bc', '第四·B/C附加赛'],
  },
  C: {
    1: ['promotion', '头名·直接升级B'],
    2: ['playoff_bc', '第二·B/C附加赛'],
    3: ['safe', '第三·留C（不降级）'],
    4: ['safe', '第四·留C（不降级）'],
  },
  AFCON: {
    1: ['qualify', '前二·直接出线区'],
    2: ['qualify', '前二·直接出线区'],
    3: ['out_risk', '第三·出局风险'],
    4: ['out_risk', '第四·出局风险'],
  },
};
const TOTAL_GAMES = 6; // 4 队主客双循环，每队 6 场

function parseCupStanding(lines) {
  const idx = lines.findIndex(l => l.includes('杯赛积分排名'));
  if (idx < 0) return null;
  const out = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const c = lines[i].split('\t').map(x => x.trim());
    if (c.length < 10) continue;
    const rank = parseInt(c[0]);
    if (!Number.isFinite(rank)) continue;
    const v = c.slice(2).map(Number);
    if (v.some(x => !Number.isFinite(x))) continue;
    out.push({ rank, name: c[1], p: v[0], w: v[1], d: v[2], l: v[3], gf: v[4], ga: v[5], gd: v[6], points: v[7] });
  }
  return out.sort((a, b) => a.rank - b.rank);
}

function nameMatch(want, names) {
  if (names.includes(want)) return want;
  const hit = names.find(n => n.includes(want) || want.includes(n));
  return hit || null;
}

// 评估单个队：分区、相邻分差、剩余场次、战意
function assess(row, all, tier) {
  const remaining = TOTAL_GAMES - row.p; // 含本场
  const nearEnd = remaining <= 2;
  const above = all.find(s => s.rank === row.rank - 1);
  const below = all.find(s => s.rank === row.rank + 1);
  const gapAbove = above ? above.points - row.points : null;
  const gapBelow = below ? row.points - below.points : null;
  // 与出线/升级区第2名的分差（判断"还有没有戏"应看这个，而不是相邻名次）
  const second = all.find(s => s.rank === 2);
  const gapToSecond = second ? second.points - row.points : null;
  // 临近末轮时，领先/落后 ≥4 分视为“基本锁定/基本无望”，用于区分战意
  const secureLead = nearEnd && gapBelow !== null && gapBelow >= 4;
  const deadInWater = nearEnd && gapAbove !== null && gapAbove >= 4;
  const canChaseAbove = gapAbove !== null && gapAbove <= 3;
  const [zoneKey, zoneLabel] = ZONE[tier][row.rank];

  let motivation, reason;
  if (tier === 'A') {
    // A 级第3/4名涉及跨组排名（留A/附加赛/直接降级），刷分持续到最后，均为 strong
    motivation = 'strong';
    reason = row.rank <= 2
      ? (secureLead ? '前二较稳，但仍争头名/1/4决赛种子' : '前二未锁定，直接抢分，战意强')
      : 'A 级第3/4名靠跨组排名定去留，须全力刷分，战意强';
  } else if (tier === 'B') {
    if (row.rank === 1) {
      motivation = secureLead ? 'medium' : 'strong';
      reason = secureLead ? '领先≥4分临近末轮，头名升级基本锁定，可能留力' : '头名未稳，须抢分确保直接升级';
    } else if (row.rank === 2) {
      motivation = 'strong';
      reason = '保第二(A/B附加赛)并争头名，身后有追兵，战意足';
    } else if (row.rank === 3) {
      motivation = canChaseAbove ? 'strong' : 'medium';
      reason = canChaseAbove ? '与第二分差≤3，主场仍可争附加赛席位，抢分动力足' : '第三留B较稳，争第二难度较大';
    } else {
      motivation = deadInWater ? 'medium' : 'strong';
      reason = deadInWater ? '垫底难追，第四(B/C附加赛)基本定局，为状态/荣誉而战' : '第四边缘，须抢分避免被动';
    }
  } else if (tier === 'C') {
    if (row.rank === 1) {
      motivation = secureLead ? 'medium' : 'strong';
      reason = secureLead ? '领先≥4分临近末轮，升级头名基本锁定，可能留力' : '头名只领先较少，须抢分确保直接升级';
    } else if (row.rank === 2) {
      motivation = 'strong';
      reason = '保第二(B/C附加赛)并争头名，竞争激烈，战意足';
    } else {
      motivation = canChaseAbove ? 'strong' : 'medium';
      reason = canChaseAbove ? 'C级不降级，但与第二分差≤3可争附加赛，有抢分动力' : '不降级且争第二难度大，动力一般';
    }
  } else { // AFCON
    if (row.rank <= 2) {
      motivation = secureLead ? 'medium' : 'strong';
      reason = secureLead ? '出线位置较稳，可能控制节奏' : '前二出线区未锁定，须抢分，战意强';
    } else {
      // 出线区外且落后第2名≥4分、仅剩≤3场 -> 理论机会极小，动力下调
      const hopeGone = remaining <= 3 && gapToSecond !== null && gapToSecond >= 4;
      motivation = (hopeGone || deadInWater) ? 'medium' : 'strong';
      reason = hopeGone
        ? '落后第2名≥4分且仅剩≤3场，出线基本无望，动力下滑'
        : (deadInWater ? '落后较多出线被动，为荣誉/理论机会而战' : '处于出线/出局边缘，本场须抢分，战意强');
    }
  }
  return {
    rank: row.rank, name: row.name, p: row.p, points: row.points, gd: row.gd,
    remaining, gapAbove, gapBelow, secureLead, deadInWater, canChaseAbove,
    zoneKey, zoneLabel, motivation, reason,
  };
}

const meta = JSON.parse(readFileSync(META, 'utf8'));
const items = meta.matches || meta;
const result = [];
const consoleLines = [];

for (const it of items) {
  const txt = readFileSync(join(RAW, `${it.id}.txt`), 'utf8');
  const raw = parseCupStanding(txt.split(/\r?\n/));
  if (!raw) { result.push({ no: it.no, id: it.id, error: '无杯赛积分段' }); continue; }
  const assessed = raw.map(r => assess(r, raw, it.tier));
  const names = assessed.map(a => a.name);
  const hName = nameMatch(it.home, names);
  const aName = nameMatch(it.away, names);
  const home = assessed.find(a => a.name === hName) || null;
  const away = assessed.find(a => a.name === aName) || null;

  // 本场形势焦点
  let focus;
  if (home && away && Math.abs(home.rank - away.rank) === 1 && Math.abs(home.points - away.points) <= 1) {
    focus = '相邻名次直接对话，胜者抢占有利位置';
  } else if (home && away && (home.motivation === 'strong' || away.motivation === 'strong')) {
    focus = `至少一方战意强（主${home ? home.motivation : '?'} / 客${away ? away.motivation : '?'}）`;
  } else {
    focus = '双方战意均非最高，留意轮换/留力';
  }

  // v2：动机不对称量化（strong=2 / medium=1 / weak=0），并标轮换风险
  const MW = { strong: 2, medium: 1, weak: 0 };
  const scoreOf = a => (a && MW[a.motivation] !== undefined ? MW[a.motivation] : null);
  const hs = scoreOf(home);
  const as = scoreOf(away);
  const riskOf = a => !!(a && /留力|锁定|控制节奏/.test(a.reason || ''));
  let motivationGap = null;
  if (hs !== null && as !== null) {
    const gap = hs - as;
    const abs = Math.abs(gap);
    const label = abs === 0 ? '双方动机对等'
      : (gap > 0 ? '主队动机更强' : '客队动机更强');
    const level = abs >= 2 ? '强不对称' : (abs === 1 ? '弱不对称' : '对等');
    motivationGap = {
      homeScore: hs, awayScore: as, gap, label, level,
      rotationRisk: { home: riskOf(home), away: riskOf(away) },
      note: abs >= 2 ? '一方明显无求，提防轮换/放水' : (abs === 1 ? '动机略有偏向，仅作叙事参考' : '双方都需要这场'),
    };
  }

  result.push({ no: it.no, id: it.id, tier: it.tier, group: it.group, table: assessed, home, away, focus, motivationGap });
  consoleLines.push(`\n#${it.no} ${it.home} vs ${it.away} [${it.tier}级 ${it.group}] — ${focus}`);
  if (motivationGap) {
    const riskTag = (motivationGap.level === '强不对称' && (motivationGap.rotationRisk.home || motivationGap.rotationRisk.away)) ? ' [有轮换风险]' : '';
    consoleLines.push(`  动机差 ${motivationGap.level}（主${motivationGap.homeScore} / 客${motivationGap.awayScore}，gap=${motivationGap.gap}，${motivationGap.label}）${riskTag}`);
  }
  for (const a of assessed) {
    const tag = a.name === hName ? '【主】' : a.name === aName ? '【客】' : '    ';
    consoleLines.push(`  ${tag}#${a.rank} ${a.name} ${a.points}分 ${a.zoneLabel} | 战意${a.motivation}（上差${a.gapAbove ?? '-'} 下差${a.gapBelow ?? '-'} 余${a.remaining}场）`);
  }
}

writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8');
console.log(consoleLines.join('\n'));
console.log(`\n[check_standings] 已写出 ${OUT}`);
