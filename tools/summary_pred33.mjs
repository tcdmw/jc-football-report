import { readFileSync } from 'node:fs';
const f = JSON.parse(readFileSync(process.argv[2], 'utf8'));
for (const x of f.preds) {
  // 阻断场无 probs/scores，如实标注后跳过，不崩
  if (!x.ok || !x.probs || !Array.isArray(x.scores)) {
    console.log(`#${x.no} ${x.home}vs${x.away} [阻断] ${x.reason || '模型不出方向'}`);
    continue;
  }
  const pr = x.probs;
  const top = x.scores.slice(0, 3).map(s => `${s.h}-${s.a}:${Math.round(s.p * 100)}%`).join(' ');
  console.log(`#${x.no} ${x.home}vs${x.away} src=${x.modelSource} λ=${x.lambdaTotal.toFixed(2)}`);
  console.log(`   HDA ${Math.round(pr.H*100)}/${Math.round(pr.D*100)}/${Math.round(pr.A*100)} o25=${Math.round(pr.o25*100)} btts=${Math.round(pr.btts*100)}`);
  console.log(`   top ${top}`);
}
