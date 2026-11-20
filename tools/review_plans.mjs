#!/usr/bin/env node
// review_plans.mjs — 复盘时读取外部方案资料（fetch_plans.py 落盘的 _plans.json）并与赛果对照
//
// 用法: node tools/review_plans.mjs <rawDir> <meta.json> [results.json]
//   例: node tools/review_plans.mjs data/raw50 data/test/meta_1117_0345_5.json data/test/results51.json
//
// 输出: 每场的外部方案结构（方案数、玩法分布、分析师与战绩、公开分析段关键词覆盖）+
//       与实际比分并列。付费隐藏的"推荐结论"不可见，故不做命中判定，只做可复核的维度对照。
import { readFileSync, existsSync } from 'node:fs';

const [rawDir, metaPath, resultsPath] = process.argv.slice(2);
if (!rawDir || !metaPath) {
  console.log('用法: node tools/review_plans.mjs <rawDir> <meta.json> [results.json]');
  process.exit(1);
}

const plansPath = `${rawDir}/_plans.json`;
if (!existsSync(plansPath)) {
  console.log(`[review_plans] 未找到 ${plansPath} — 该批次赛前未采集外部方案资料。`);
  console.log('  说明: 球探首页仅覆盖在售赛事，赛后无法回溯；需在赛前调用 tools/fetch_plans.py 落盘。');
  process.exit(0);
}

const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
const plans = JSON.parse(readFileSync(plansPath, 'utf8'));
const results = resultsPath && existsSync(resultsPath)
  ? JSON.parse(readFileSync(resultsPath, 'utf8')).results : {};

// 公开分析段的关键维度（专家方案在这些维度上是否有明确表述，可复核）
const DIMS = {
  '伤停': /伤停|受伤|缺阵|停赛|伤缺/,
  '战意': /战意|保级|争冠|出线|欲望|轮换|留力/,
  '体能': /体能|休息|休整|连续作战|赛程密集|旅途/,
  '交锋': /交锋|往绩|历史交手|对阵记录/,
  '水位': /水位|升水|降水|低水|高水|盘口/,
  '大球': /大球|进球多|开放|进攻火力/,
  '小球': /小球|进球少|防守稳|闷战/,
};

const SIDE = ['主', '平', '客'];
let totalPlans = 0, withPub = 0;
const playCnt = {}, analystSet = new Set();

console.log(`[review_plans] 来源=${plans.source} 采集=${plans.collectedAt}`);
console.log('');

const byId = new Map((plans.items || []).map(x => [x.id, x]));
for (const m of meta.matches) {
  const p = byId.get(m.id);
  const r = results[m.no];
  const sc = Array.isArray(r) ? `${r[0]}-${r[1]}` : '—';
  const act = Array.isArray(r) ? SIDE[r[0] > r[1] ? 0 : r[0] === r[1] ? 1 : 2] : '—';

  if (!p || !p.plans.length) {
    console.log(`#${m.no} ${m.home} vs ${m.away}  实际 ${sc} (${act})  | 无方案资料`);
    continue;
  }
  totalPlans += p.plans.length;
  const dimCover = {};
  const names = [];
  for (const pl of p.plans) {
    if (pl.play) playCnt[pl.play] = (playCnt[pl.play] || 0) + 1;
    if (pl.analyst) { names.push(`${pl.analyst}${pl.record ? '(' + pl.record + ')' : ''}`); analystSet.add(pl.analyst); }
    const pub = pl.pubText || '';
    if (pub) {
      withPub++;
      for (const [k, re] of Object.entries(DIMS)) if (re.test(pub)) dimCover[k] = (dimCover[k] || 0) + 1;
    }
  }
  console.log(`#${m.no} ${m.home} vs ${m.away}  实际 ${sc} (${act})  | 方案 ${p.plans.length} 条`);
  console.log(`   玩法: ${p.plans.map(x => x.play || '未标注').join(' / ')}`);
  console.log(`   分析师: ${names.join('、')}`);
  if (Object.keys(dimCover).length) {
    console.log(`   公开段维度覆盖: ${Object.entries(dimCover).map(([k, v]) => `${k}${v}/${p.plans.length}`).join(' ')}`);
  }
  console.log(`   结论可见: 否（付费隐藏，未绕过）`);
  console.log('');
}

console.log('--- 汇总 ---');
console.log(`方案 ${totalPlans} 条 | 含公开分析段 ${withPub} 条 | 去重分析师 ${analystSet.size} 位`);
if (Object.keys(playCnt).length) {
  console.log(`玩法分布: ${Object.entries(playCnt).map(([k, v]) => `${k} ${v}`).join(' | ')}`);
}
console.log('注: 付费隐藏的推荐结论不可见，故不做命中率统计；本工具只提供可复核的外部观点结构。');
