// build_results.mjs — 按 meta 把真实比分映射成各批次 results.json
import { readFileSync, writeFileSync } from 'node:fs';

// ID -> [gh, ga] 全场比分，来自即时比分页（浏览器通道）
const SCORE = {
  '3000163': [1, 0], '3000164': [2, 1], '3000165': [2, 0], '3000167': [1, 2],
  '3000169': [1, 2], '3000172': [4, 0], '3000523': [1, 1], '3000525': [2, 0],
  '3000527': [2, 1], '3041393': [2, 1], '3026781': [0, 2], '3041394': [2, 1],
  '3019186': [1, 2], '3019188': [2, 0], '3019190': [0, 1], '3003945': [1, 0],
  '3008321': [0, 5], '3008324': [1, 2], '3008331': [1, 1], '3018858': [2, 1],
  '3018863': [1, 2], '3018864': [2, 2], '3018865': [5, 2], '3003939': [1, 0],
  '3003943': [1, 1], '2912330': [0, 0], '2912934': [4, 1], '3003947': [3, 1],
  '3013757': [1, 1], '3018866': [1, 0], '2995394': [1, 0], '2996199': [0, 1],
  '3013760': [0, 3],
};

const batches = [
  ['meta_1107_j2_6', 'results2'],
  ['meta_1107_j1_3', 'results3'],
  ['meta_1107_mix_3', 'results4'],
  ['meta_1107_g2_3', 'results5'],
  ['meta_1107_eg_4', 'results6'],
  ['meta_1107_bd_4', 'results7'],
  ['meta_1107_epl_2', 'results8'],
  ['meta_1108_3', 'results9'],
  ['meta_1108_0130_3', 'results10'],
  ['meta_1108_0400_3', 'results11'],
];

for (const [metaName, outName] of batches) {
  const meta = JSON.parse(readFileSync(`data/test/${metaName}.json`, 'utf8'));
  const results = {};
  let miss = [];
  for (const m of meta.matches) {
    if (SCORE[m.id]) results[m.no] = SCORE[m.id];
    else miss.push(m.id);
  }
  writeFileSync(`data/test/${outName}.json`, JSON.stringify({ results }, null, 1));
  console.log(`${outName}: ${Object.keys(results).length} 场${miss.length ? ' 缺 ' + miss : ''}`);
}
