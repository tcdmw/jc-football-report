#!/usr/bin/env node
// review_agg.mjs — 双轨聚合（Node + engine）
// 用法: node tools/review_agg.mjs [批次列表，逗号分隔，如 47,48,49,50,51]
import { readFileSync } from 'node:fs';
const argList = process.argv[2] ? process.argv[2].split(',').map(Number) : [37, 38, 40, 41, 44, 45, 46, 47, 48, 49, 50, 51];
const batches = argList;
const argmax = a => a.indexOf(Math.max(...a));
const brier = (p, act) => { const y=[0,0,0]; y[act]=1; return p.reduce((s,v,i)=>s+(v-y[i])**2,0); };
const SIDE=['主','平','客'];
const T={n:0,nodeDir:0,engDir:0,rq:0,rqN:0,ou:0,t1:0,t3:0,t5:0,draws:0,nodeBrier:0,engBrier:0,detail:[]};
for(const b of batches){
  const preds=JSON.parse(readFileSync(`data/out/preds${b}.json`,'utf8')).preds;
  const eng=JSON.parse(readFileSync(`data/out/engine${b}.json`,'utf8')).preds;
  const results=JSON.parse(readFileSync(`data/test/results${b}.json`,'utf8')).results;
  for(const p of preds){
    const r=results[p.no]; if(!r) continue;
    // 阻断场无 probs，不计入命中率，单独计数
    if(!p.probs || !Array.isArray(p.scores)){ T.blocked=(T.blocked||0)+1; continue; }
    const [gh,ga]=r,tot=gh+ga;
    const act=gh>ga?0:gh===ga?1:2;
    if(act===1) T.draws++;
    T.n++;
    const mp=[p.probs.H,p.probs.D,p.probs.A];
    const nodePick=argmax(mp);
    if(nodePick===act) T.nodeDir++;
    T.nodeBrier+=brier(mp,act);
    const e=eng.find(x=>x.no===p.no);
    let engPick=null;
    if(e){
      const ep=[e.engine.H,e.engine.D,e.engine.A];
      engPick=argmax(ep);
      if(engPick===act) T.engDir++;
      T.engBrier+=brier(ep,act);
    }
    if(typeof p.hcUser==='number'&&p.probs.rq){
      T.rqN++;
      const net=(gh-ga)-p.hcUser;
      const ra=net>0?0:net===0?1:2;
      if(argmax(p.probs.rq)===ra) T.rq++;
    }
    const ouPick=p.probs.o25>=0.5?1:0;
    if((tot>2.5?1:0)===ouPick) T.ou++;
    const sc=`${gh}-${ga}`;
    if(p.scores[0]&&`${p.scores[0].h}-${p.scores[0].a}`===sc) T.t1++;
    if(p.scores.slice(0,3).some(x=>`${x.h}-${x.a}`===sc)) T.t3++;
    if(p.scores.slice(0,5).some(x=>`${x.h}-${x.a}`===sc)) T.t5++;
    T.detail.push({home:p.home,sc,node:SIDE[nodePick],eng:engPick===null?'-':SIDE[engPick],act:SIDE[act],
      nodeHit:nodePick===act,engHit:engPick===act});
  }
}
const pct=x=>(x*100).toFixed(1)+'%';
const nEng=T.detail.filter(d=>d.eng!=='-').length;
console.log(`总样本 n=${T.n} | 实际平局 ${T.draws} (${pct(T.draws/T.n)}) | 阻断未计 ${T.blocked||0} 场`);
console.log(`Node 方向 ${T.nodeDir}/${T.n}=${pct(T.nodeDir/T.n)} | engine 方向 ${T.engDir}/${nEng}=${pct(T.engDir/nEng)}`);
console.log(`让球 rq ${T.rq}/${T.rqN}=${pct(T.rq/T.rqN)} | 大小2.5 ${T.ou}/${T.n}=${pct(T.ou/T.n)}`);
console.log(`比分 top1/3/5 = ${T.t1}/${T.t3}/${T.t5} = ${pct(T.t1/T.n)}/${pct(T.t3/T.n)}/${pct(T.t5/T.n)}`);
console.log(`Brier Node ${(T.nodeBrier/T.n).toFixed(4)} | engine ${(T.engBrier/nEng).toFixed(4)}`);
console.log('--- 逐场 ---');
for(const d of T.detail)
  console.log(`${d.home.padEnd(10)} ${d.sc.padStart(4)} | Node${d.node}${d.nodeHit?'✓':'✗'} eng${d.eng}${d.eng!=='-'?(d.engHit?'✓':'✗'):''} 实际${d.act}`);
