// backtest_all.mjs — 聚合 10 个批次的整体回测
import { readFileSync } from 'node:fs';

const pairs = [
  ['preds2', 'results2'], ['preds3', 'results3'], ['preds4', 'results4'],
  ['preds5', 'results5'], ['preds6', 'results6'], ['preds7', 'results7'],
  ['preds8', 'results8'], ['preds9', 'results9'], ['preds10', 'results10'],
  ['preds11', 'results11'],
];

const argmax = a => a.indexOf(Math.max(...a));
const brier = (p, act) => {
  const y = [0, 0, 0]; y[act] = 1;
  return p.reduce((s, v, i) => s + (v - y[i]) ** 2, 0);
};

const T = { n: 0, dir: 0, rq: 0, rqN: 0, ou: 0, iv: 0, t1: 0, t3: 0, t5: 0, brierSum: 0, detail: [] };

for (const [pn, rn] of pairs) {
  const preds = JSON.parse(readFileSync(`data/out/${pn}.json`, 'utf8')).preds;
  const results = JSON.parse(readFileSync(`data/test/${rn}.json`, 'utf8')).results;
  for (const p of preds) {
    const r = results[p.no];
    if (!r) continue;
    const [gh, ga] = r, tot = gh + ga;
    const act = gh > ga ? 0 : gh === ga ? 1 : 2;
    T.n++;
    const mp = [p.probs.H, p.probs.D, p.probs.A];
    if (argmax(mp) === act) T.dir++;
    if (typeof p.hcUser === 'number' && p.probs.rq) {
      T.rqN++;
      const net = (gh - ga) - p.hcUser;
      const actual = net > 0 ? 0 : net === 0 ? 1 : 2;
      if (argmax(p.probs.rq) === actual) T.rq++;
    }
    const ouPick = p.probs.o25 >= 0.5 ? 1 : 0;
    if ((tot > 2.5 ? 1 : 0) === ouPick) T.ou++;
    const ivMax = Object.entries(p.intervals).sort((a, b) => b[1] - a[1])[0][0];
    const ivHit = (ivMax === '0-1' && tot <= 1) || (ivMax === '2-3' && tot >= 2 && tot <= 3)
      || (ivMax === '4-6' && tot >= 4 && tot <= 6) || (ivMax === '7+' && tot >= 7);
    if (ivHit) T.iv++;
    const sc = `${gh}-${ga}`;
    if (p.scores[0] && `${p.scores[0].h}-${p.scores[0].a}` === sc) T.t1++;
    if (p.scores.slice(0, 3).some(x => `${x.h}-${x.a}` === sc)) T.t3++;
    if (p.scores.slice(0, 5).some(x => `${x.h}-${x.a}` === sc)) T.t5++;
    T.brierSum += brier(mp, act);
    T.detail.push({ home: p.home, away: p.away, sc, pick: ['主', '平', '客'][argmax(mp)], hit: argmax(mp) === act });
  }
}

const pct = x => `${(x * 100).toFixed(1)}%`;
console.log(`总样本 n=${T.n}`);
console.log(`方向命中   ${T.dir}/${T.n} = ${pct(T.dir / T.n)}`);
console.log(`让球盘     ${T.rq}/${T.rqN} = ${pct(T.rq / T.rqN)}`);
console.log(`大小2.5    ${T.ou}/${T.n} = ${pct(T.ou / T.n)}`);
console.log(`进球区间   ${T.iv}/${T.n} = ${pct(T.iv / T.n)}`);
console.log(`比分 top1/3/5: ${T.t1}/${T.t3}/${T.t5} = ${pct(T.t1 / T.n)}/${pct(T.t3 / T.n)}/${pct(T.t5 / T.n)}`);
console.log(`平均 Brier = ${(T.brierSum / T.n).toFixed(4)}`);
