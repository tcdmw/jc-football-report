#!/usr/bin/env node
// test_fund_check.mjs — check_line 盘口×基本面交叉验证的端到端测试（合成文件，黑盒跑真实 CLI）
// 覆盖：升盘背离、退盘背离、数据不足（一致/中性/盘口退平已由 raw37/raw38 真实批次覆盖）
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = join(fileURLToPath(import.meta.url), '..');
const checkLine = join(here, 'check_line.mjs');
const dir = mkdtempSync(join(tmpdir(), 'fundcheck-'));

const meta = { matches: [{ no: 1, id: 'T1', home: '主', away: '客' }] };
const preds = { preds: [{ no: 1, probs: { H: 0.55, D: 0.25, A: 0.2 } }] };
const engine = { preds: [{ no: 1, engine: { H: 0.6, D: 0.25, A: 0.15 } }] };

// 客队强（fundSide=away）
const strongAway = {
  overall: {
    home: { points: 8, rank: 15 },
    away: { points: 20, rank: 3 }
  },
  form: { home: { gf: 5, ga: 5 }, away: { gf: 5, ga: 5 } },
  leagueOf: { home: 'X', away: 'X' }
};
const restNeutral = { home: 3, away: 3 };

function run(name, lines, matchRow, expect) {
  const rawDir = join(dir, name);
  mkdirSync(rawDir, { recursive: true });
  writeFileSync(join(rawDir, 'T1.line.json'), JSON.stringify({ lines }));
  const metaP = join(dir, name + '_meta.json');
  const predsP = join(dir, name + '_preds.json');
  const engP = join(dir, name + '_eng.json');
  const matchP = join(dir, name + '_matches.json');
  writeFileSync(metaP, JSON.stringify(meta));
  writeFileSync(predsP, JSON.stringify(preds));
  writeFileSync(engP, JSON.stringify(engine));
  writeFileSync(matchP, JSON.stringify({ matches: [matchRow] }));
  const r = spawnSync(process.execPath, [checkLine, rawDir, metaP, predsP, engP, matchP], { encoding: 'utf8' });
  const out = r.stdout + r.stderr;
  let ok = true;
  for (const e of expect) {
    if (!out.includes(e)) { ok = false; console.log(`  ✗ ${name} 缺少 "${e}"`); }
  }
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  return ok;
}

let all = true;

// 场景A：升盘背离（0→0.5，多数升盘，lineDir=home，基本面偏 away）
const linesAdv = Array.from({ length: 5 }, () => ({ openHc: 0, liveHc: 0.5 }));
all = run('升盘背离', linesAdv,
  { no: 1, team: strongAway, restDays: restNeutral, dqdIntel: null },
  ['背离', '资金热/诱盘']) && all;

// 场景C：退盘背离（0.75→0.5，多数退盘但仍≥0.5，lineDir=home，基本面偏 away）
const linesRet = Array.from({ length: 5 }, () => ({ openHc: 0.75, liveHc: 0.5 }));
all = run('退盘背离', linesRet,
  { no: 1, team: strongAway, restDays: restNeutral, dqdIntel: null },
  ['背离', '资金热下盘']) && all;

// 场景B：数据不足（无 overall）
all = run('数据不足', linesAdv,
  { no: 1, team: {}, restDays: restNeutral, dqdIntel: null },
  ['数据不足']) && all;

rmSync(dir, { recursive: true, force: true });
process.exit(all ? 0 : 1);
