#!/usr/bin/env node
// tools/backtest.mjs — 自主结算回测（不依赖 scripts/analyze.js 的 backtest：该函数在 devig=null 时崩溃）
// 让球结算统一按业务口径：net = (主-客) - hc（hc 主让为正）
// 用法: node tools/backtest.mjs data/out/preds.json data/test/results.json

import { readFileSync } from 'node:fs';

const PREDS = process.argv[2] || 'data/out/preds.json';
const RESULTS = process.argv[3] || 'data/test/results_1146_11.json';

const predsPayload = JSON.parse(readFileSync(PREDS, 'utf8'));
const preds = predsPayload.preds || predsPayload;
const resPayload = JSON.parse(readFileSync(RESULTS, 'utf8'));
const results = resPayload.results || resPayload;

const SIDE = ['主', '平', '客'];
const argmax = a => a.indexOf(Math.max(...a));
const pct = x => (x === null || x === undefined ? 'n/a' : `${(x * 100).toFixed(1)}%`);

function brier3(p, act) {
  const y = [0, 0, 0]; y[act] = 1;
  return [p[0], p[1], p[2]].reduce((s, v, i) => s + (v - y[i]) ** 2, 0);
}

const rows = [];
for (const p of preds) {
  const r = results[p.no];
  if (!r) continue;
  const [gh, ga] = r;
  const tot = gh + ga;
  const act = gh > ga ? 0 : gh === ga ? 1 : 2;
  const mp = [p.probs.H, p.probs.D, p.probs.A];
  const mpick = argmax(mp);

  let dpick = null, devigHit = null, brierMkt = null;
  if (p.devig) {
    dpick = argmax(p.devig);
    devigHit = dpick === act;
    brierMkt = brier3(p.devig, act);
  }

  // 让球（仅 hc 存在）
  let rqHit = null, rqNet = null, rqPick = null;
  if (typeof p.hcUser === 'number' && p.probs.rq) {
    rqNet = (gh - ga) - p.hcUser;
    const actual = rqNet > 0 ? 0 : rqNet === 0 ? 1 : 2;
    rqPick = argmax(p.probs.rq);
    rqHit = rqPick === actual;
  }

  // 大小 2.5
  const ouPick = p.probs.o25 >= 0.5 ? 1 : 0;
  const ouHit = (tot > 2.5 ? 1 : 0) === ouPick;

  // 总进球档位 & 区间
  const bIdx = Math.min(tot, 7);
  const bHit = argmax(p.buckets) === bIdx;
  const ivMax = Object.entries(p.intervals).sort((a, b) => b[1] - a[1])[0][0];
  const ivHit = (ivMax === '0-1' && tot <= 1) || (ivMax === '2-3' && tot >= 2 && tot <= 3)
    || (ivMax === '4-6' && tot >= 4 && tot <= 6) || (ivMax === '7+' && tot >= 7);

  const sc = `${gh}-${ga}`;
  const top1 = p.scores[0] && `${p.scores[0].h}-${p.scores[0].a}` === sc;
  const top3 = p.scores.slice(0, 3).some(x => `${x.h}-${x.a}` === sc);
  const top5 = p.scores.slice(0, 5).some(x => `${x.h}-${x.a}` === sc);

  rows.push({
    no: p.no, home: p.home, away: p.away, score: sc, tot,
    act: SIDE[act], model: SIDE[mpick], devig: dpick === null ? null : SIDE[dpick],
    modelHit: mpick === act, devigHit, rqHit, rqNet, rqPick: rqPick === null ? null : SIDE[rqPick],
    ouHit, bHit, ivHit, top1, top3, top5,
    brierModel: brier3(mp, act), brierMkt, margin: p.margin,
  });
}

const sum = (arr, k) => arr.filter(r => r[k]).length;
const n = rows.length;
const nMkt = rows.filter(r => r.devigHit !== null).length;
const avg = (arr, k) => { const v = arr.filter(r => r[k] !== null && r[k] !== undefined); return v.length ? v.reduce((s, r) => s + r[k], 0) / v.length : null; };

console.log(`[backtest] n=${n}（有赛果）| 有欧赔 ${nMkt}`);
console.log(`  方向命中 模型 ${sum(rows, 'modelHit')}/${n} = ${pct(sum(rows, 'modelHit') / n)}`);
console.log(`  方向命中 市场 ${sum(rows, 'devigHit')}/${nMkt} = ${pct(sum(rows, 'devigHit') / nMkt)}`);
console.log(`  让球盘    ${sum(rows, 'rqHit')}/${n} = ${pct(sum(rows, 'rqHit') / n)}`);
console.log(`  大小 2.5  ${sum(rows, 'ouHit')}/${n} = ${pct(sum(rows, 'ouHit') / n)}`);
console.log(`  总进球档位 ${sum(rows, 'bHit')}/${n} | 区间 ${sum(rows, 'ivHit')}/${n} = ${pct(sum(rows, 'ivHit') / n)}`);
console.log(`  比分 top1 ${sum(rows, 'top1')}/${n} | top3 ${sum(rows, 'top3')}/${n} | top5 ${sum(rows, 'top5')}/${n}`);
console.log(`  Brier 模型 ${avg(rows, 'brierModel').toFixed(4)} | Brier 市场 ${nMkt ? avg(rows, 'brierMkt').toFixed(4) : 'n/a'}`);
console.log('no 主队            客队        比分  模型 市场 让球(net)      Brier');
for (const r of rows) {
  const rq = r.rqHit === null ? '  n/a        ' : `${r.rqHit ? '赢' : '输'}  ${String(r.rqNet).padStart(3)} (押${r.rqPick})`;
  console.log(`${String(r.no).padStart(2)} ${r.home.padEnd(13)} ${(r.away || '').padEnd(10)} ${r.score.padStart(4)}  ${r.model.padStart(2)}  ${(r.devig || '--').padStart(2)}  ${rq.padEnd(12)} ${r.brierModel.toFixed(3)}`);
}
