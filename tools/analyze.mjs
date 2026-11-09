#!/usr/bin/env node
// tools/analyze.mjs — matches.json → preds.json，内嵌程序化自检
// 缺独立输入（team=null）的场次判 BLOCKED，进程退出码 3；绝不降级出方向。
// 用法: node tools/analyze.mjs [data/out/matches.json] [data/out/preds.json]

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';

const A = createRequire(import.meta.url)('../scripts/analyze.js');

const SRC = process.argv[2] || 'data/out/matches.json';
const OUT = process.argv[3] || 'data/out/preds.json';

const payload = JSON.parse(readFileSync(SRC, 'utf8'));
const matches = payload.matches || payload;

const preds = [];
const problems = [];
const blocked = [];

for (const m of matches) {
  // 符号口径：本项目输出「主让为正」，而脚本内 rqProb 用 (主-客)+hc（主让为负）
  const hcModel = typeof m.hc === 'number' ? -m.hc : m.hc;
  const p = A.predictMatch({ ...m, hc: hcModel });
  p.hcUser = m.hc;
  p.hcModel = hcModel;
  p.hc = m.hc; // 对外恢复业务口径
  const tag = `${p.no} ${p.home}`;

  // 自检 1：模型可用
  if (!p.ok) {
    problems.push(`${tag}: 模型不可用 — ${p.reason}`);
  }
  // 自检 2：独立输入（阻断条款）
  if (!m.team) {
    blocked.push(`${tag}: 缺主客分离得失球（页面积分段未解析），按阻断规则不出方向`);
  }
  // 自检 2b：低样本阻断（主队主场 P 或客队客场 P <3，防单场样本静默外推）
  if (m.team) {
    const hp = m.team.home && m.team.home.home ? m.team.home.home.p : null;
    const ap = m.team.away && m.team.away.away ? m.team.away.away.p : null;
    if (hp === null || ap === null || hp < 3 || ap < 3) {
      blocked.push(`${tag}: 样本不足（主队主场 P=${hp}，客队客场 P=${ap}，任一 <3），按低样本规则拒跑，不采信外推方向`);
    }
  }
  // 自检 3：无市场源时不得给方向
  if (!m.spf) {
    const why = m.jcNotOpen ? '竞彩暂无数据（未开盘）' : '页面为 000（竞彩未开）';
    problems.push(`${tag}: 无竞彩胜平负（${why}），市场 λ 缺失，仅独立模型`);
  }
  // 自检 4：让球结算基准
  if (m.hc !== null && m.hc !== undefined && Math.abs(m.hc) > 3) {
    problems.push(`${tag}: 让球 ${m.hc} 超出常规范围`);
  }
  preds.push(p);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({
  source: SRC,
  generatedAt: new Date().toISOString(),
  count: preds.length,
  blocked,
  problems,
  preds,
}, null, 1), 'utf8');

const pct = x => (x === null ? ' n/a ' : (100 * x).toFixed(0).padStart(3));
console.log(`[analyze] ${preds.length} 场 | 阻断 ${blocked.length} | 问题 ${problems.length}`);
console.log('no 主队              λmkt  λteam   λ     H-D-A%      方向   判定');
for (const p of preds) {
  if (!p.ok) { console.log(`${p.no} ${p.home}  模型不可用: ${p.reason}`); continue; }
  const dir = p.probs.H >= p.probs.D && p.probs.H >= p.probs.A ? '主' : p.probs.D >= p.probs.A ? '平' : '客';
  console.log(
    `${String(p.no).padStart(2)} ${p.home.padEnd(14)} ${(p.marketLambda?.toFixed(2) ?? 'n/a').padStart(5)} ${(p.teamLambda?.toFixed(2) ?? 'n/a').padStart(6)} ${p.lambdaTotal.toFixed(2).padStart(5)}  ${pct(p.probs.H)}/${pct(p.probs.D)}/${pct(p.probs.A)}  ${dir}   ${p.verdict ? p.verdict.level : ''}`
  );
}
for (const w of problems) console.log(`  ! ${w}`);
for (const b of blocked) console.log(`  ✗ BLOCKED ${b}`);

process.exitCode = (blocked.length > 0 || preds.some(p => !p.ok)) ? 3 : 0;
