#!/usr/bin/env node
// review_consensus.mjs — 懂球帝「专家方案分布」复盘对照
//
// 用法: node tools/review_consensus.mjs [rawDir ...]      // 无参数则扫 data/raw*
//
// 读 <rawDir>/_dqd_consensus.json + <rawDir>/<titanId>.dqd_tips.json，
// 用页面积分（pageScore）作实际结果，判定「专家共识最大占比选项」是否命中：
//   1) 竞彩胜平负：负/平/胜
//   2) 总进球数：大球/小球（按 2.5 线近似，仅作口径参考）
//   3) 竞彩让球：客队/让平/主队
//   4) 主客队：上盘/下盘（亚盘口径，命中需盘口，故只列不判）
import { readFileSync, existsSync, readdirSync } from 'node:fs';

const roots = process.argv.length > 2 ? process.argv.slice(2) : readdirSync('data')
  .filter(d => /^raw\d+$/.test(d)).map(d => `data/${d}`);

const rows = [];
for (const rd of roots) {
  const idx = `${rd}/_dqd_consensus.json`;
  if (!existsSync(idx)) continue;
  const meta = JSON.parse(readFileSync(idx, 'utf8'));
  for (const it of meta.matched || []) {
    const p = `${rd}/${it.titanId}.dqd_tips.json`;
    if (!existsSync(p)) continue;
    rows.push({ raw: rd, ...JSON.parse(readFileSync(p, 'utf8')) });
  }
}

const pick = (dist, play) => {
  const d = dist.find(x => x.play === play);
  if (!d || !d.options.length) return null;
  const top = d.options.slice().sort((a, b) => b.rate - a.rate)[0];
  return { top: top.label, rate: top.rate, count: d.count, all: d.options };
};

let nHA = 0, okHA = 0, nOU = 0, okOU = 0, nRQ = 0, okRQ = 0;
const lines = [];

for (const r of rows) {
  const m = (r.pageScore || '').match(/(\d+)\s*-\s*(\d+)/);
  if (!m) continue;
  const gh = +m[1], ga = +m[2];
  const actHA = gh > ga ? '胜' : gh === ga ? '平' : '负';
  const actOU = gh + ga >= 3 ? '大球' : '小球';
  const actRQ = actHA === '平' ? '让平' : actHA === '胜' ? '主队' : '客队';

  const ha = pick(r.expertDist, '竞彩胜平负');
  const ou = pick(r.expertDist, '总进球数');
  const rq = pick(r.expertDist, '竞彩让球');
  const hc = pick(r.expertDist, '主客队');

  const marks = [];
  if (ha) { nHA++; if (ha.top === actHA) okHA++; marks.push(`胜平负 押${ha.top}(${ha.rate}%)→${actHA}${ha.top === actHA ? ' ✓' : ' ✗'}`); }
  if (ou) { nOU++; if (ou.top === actOU) okOU++; marks.push(`大小 押${ou.top}(${ou.rate}%)→实${gh + ga}球${ou.top === actOU ? ' ✓' : ' ✗'}`); }
  if (rq) { nRQ++; if (rq.top === actRQ) okRQ++; }
  if (hc) marks.push(`上下盘 押${hc.top}(${hc.rate}%)`);

  lines.push({
    head: `${r.home} ${gh}-${ga} ${r.away}  [${r.league} ${r.kickoff}] ${r.raw}`,
    n: r.planTotal || 0,
    marks, hc,
  });
}

console.log(`[review_consensus] 可对照 ${lines.length} 场（来自 ${roots.length} 个目录）\n`);
for (const l of lines) {
  console.log(`■ ${l.head}   专家方案 ${l.n} 条`);
  console.log(`   ${l.marks.join('   ')}`);
  console.log('');
}
console.log('--- 专家共识命中率汇总 ---');
console.log(`竞彩胜平负: ${okHA}/${nHA} = ${nHA ? (okHA / nHA * 100).toFixed(1) : 0}%`);
console.log(`总进球 大/小(2.5线): ${okOU}/${nOU} = ${nOU ? (okOU / nOU * 100).toFixed(1) : 0}%`);
console.log(`竞彩让球方向: ${okRQ}/${nRQ} = ${nRQ ? (okRQ / nRQ * 100).toFixed(1) : 0}%`);
console.log('\n注: 分布为懂球帝「专家方案分布」聚合（免费可见），单条方案正文仍需付费；');
console.log('    总进球按 3 球分界近似 2.5 盘，仅作口径参考，不等同具体盘口结算。');
