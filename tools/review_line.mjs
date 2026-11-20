#!/usr/bin/env node
// review_line.mjs — check_line 五档标记 vs 实际结果（跨7批，复用其判定逻辑）
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const batches = [
  [37, '1600_2', 37], [38, '1800_4', 38], [40, '1930_1', 39], [41, '2130_1', 40],
  [44, '0100_2', 43], [45, '0130_3', 44], [46, '0345_4', 45],
];
const median = arr => {
  const s = [...arr].sort((a, b) => a - b), n = s.length;
  if (!n) return 0;
  const m = Math.floor(n / 2);
  return n % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
function fundSideOf(match) {
  const t = match.team || {}, ov = t.overall || {}, lg = t.leagueOf || {}, form = t.form || {}, rest = match.restDays || {};
  const votes = [];
  if (ov.home && ov.away && lg.home === lg.away) {
    const dPts = ov.home.points - ov.away.points, dRank = ov.away.rank - ov.home.rank;
    if (dPts >= 4 && dRank >= 2) votes.push('home');
    else if (dPts <= -4 && dRank <= -2) votes.push('away');
    else votes.push('neutral');
  } else votes.push('neutral');
  if (form.home && form.away) {
    const d = (form.home.gf - form.home.ga) - (form.away.gf - form.away.ga);
    if (d >= 3) votes.push('home'); else if (d <= -3) votes.push('away'); else votes.push('neutral');
  } else votes.push('neutral');
  if (typeof rest.home === 'number' && typeof rest.away === 'number') {
    const d = rest.home - rest.away;
    if (d >= 3) votes.push('home'); else if (d <= -3) votes.push('away'); else votes.push('neutral');
  } else votes.push('neutral');
  const h = votes.filter(v => v === 'home').length, a = votes.filter(v => v === 'away').length;
  return h > a ? 'home' : a > h ? 'away' : 'neutral';
}
const rows = [];
for (const [b, mn, raw] of batches) {
  const meta = JSON.parse(readFileSync(`data/test/meta_${mn}.json`, 'utf8'));
  const matches = JSON.parse(readFileSync(`data/out/matches${b}.json`, 'utf8')).matches;
  const results = JSON.parse(readFileSync(`data/test/results${b}.json`, 'utf8')).results;
  for (const m of meta.matches) {
    const lp = join(`data/raw${raw}`, `${m.id}.line.json`);
    if (!exists(lp)) continue;
    const lines = JSON.parse(readFileSync(lp, 'utf8')).lines;
    let neg = 0, pos = 0;
    const liveAbs = [], openAbs = [], dirs = [];
    for (const l of lines) {
      if (l.liveHc < 0) neg++; else if (l.liveHc > 0) pos++;
      liveAbs.push(Math.abs(l.liveHc)); openAbs.push(Math.abs(l.openHc));
      if (Math.abs(l.liveHc) < Math.abs(l.openHc)) dirs.push('r');
      else if (Math.abs(l.liveHc) > Math.abs(l.openHc)) dirs.push('a');
    }
    const favSide = neg > pos ? 'away' : pos > neg ? 'home' : 'none';
    const retreat = dirs.filter(d => d === 'r').length, advance = dirs.filter(d => d === 'a').length;
    const valid = lines.length;
    const retreatMajority = retreat > valid / 2, advanceMajority = advance > valid / 2;
    const medLive = median(liveAbs), medOpen = median(openAbs);
    let lineDir = favSide;
    if (retreatMajority && medLive <= 0.25) lineDir = 'none';
    const match = matches.find(x => x.no === m.no);
    const fs = match ? fundSideOf(match) : 'neutral';
    let mark;
    if (lineDir === 'none') mark = '盘口退平';
    else if (fs === 'neutral') mark = '中性';
    else mark = fs === lineDir ? '一致' : '背离';
    // HDA 冲突单独标记
    const hdaConflict = retreat / valid >= 2 / 3 && advance / valid <= 0.1 && medLive < medOpen && medLive <= 0.5;
    if (hdaConflict && lineDir !== 'none') mark = 'HDA冲突';
    // 实际让球方结果
    const [gh, ga] = results[m.no];
    const margin = favSide === 'home' ? gh - ga : favSide === 'away' ? ga - gh : gh - ga;
    const favOutcome = margin > 0 ? '让球方赢' : margin === 0 ? '平' : '让球方输';
    rows.push({ home: m.home, favSide, mark, margin, favOutcome });
  }
}
function exists(p) { try { readFileSync(p); return true; } catch { return false; } }
// 按标记评估
const groups = {};
for (const r of rows) {
  (groups[r.mark] = groups[r.mark] || []).push(r);
}
console.log('总样本', rows.length);
for (const mark of ['一致', 'HDA冲突', '背离', '中性', '盘口退平']) {
  const g = groups[mark];
  if (!g) continue;
  let hit = 0, judged = 0;
  for (const r of g) {
    if (mark === '一致') { judged++; if (r.margin > 0) hit++; }
    else if (mark === 'HDA冲突') { judged++; if (r.margin <= 0) hit++; } // 建议受让方不败
    else if (mark === '背离') { judged++; if (r.margin <= 0) hit++; }
  }
  console.log(`\n【${mark}】${g.length} 场 | 有明确倾向 ${judged}，命中 ${hit} = ${judged ? (hit / judged * 100).toFixed(1) : '-'}%`);
  for (const r of g) console.log(`  ${r.home.padEnd(10)} ${r.favOutcome} (margin${r.margin})`);
}
