#!/usr/bin/env node
// check_fetch.mjs — 赛前采集完整性校验（不依赖赛果）。
// 逐场确认 txt 与 handicap.json 存在且关键字段非空，输出 PASS/FAIL。
// 用法: node tools/check_fetch.mjs <批次目录> <清单/meta.json>
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIR = process.argv[2];
const META = process.argv[3];
if (!DIR || !META) {
  console.log('用法: node tools/check_fetch.mjs <批次目录> <清单.json>');
  process.exit(2);
}

const items = JSON.parse(readFileSync(META, 'utf8')).matches;
let fails = 0;
console.log(`[check_fetch] 目录 ${DIR}，应到 ${items.length} 场`);

for (const it of items) {
  const errs = [];
  const txtPath = join(DIR, `${it.id}.txt`);
  const hcPath = join(DIR, `${it.id}.handicap.json`);

  if (!existsSync(txtPath) || readFileSync(txtPath, 'utf8').trim().length === 0) {
    errs.push('txt 缺失或为空');
  }
  if (!existsSync(hcPath)) {
    errs.push('handicap.json 缺失');
  } else {
    let h;
    try { h = JSON.parse(readFileSync(hcPath, 'utf8')); }
    catch { h = null; errs.push('handicap.json 无法解析'); }
    if (h) {
      if (typeof h.hc !== 'number') errs.push('hc 非数字');
      if (!h.ou) errs.push('大小球盘口 ou 为空');
      if (!h.live || !h.live.over || !h.live.under) errs.push('即时大小球水位缺失');
      if (!h.open || typeof h.open.hc !== 'number') errs.push('初盘结构缺失');
    }
  }

  if (errs.length) {
    fails++;
    console.log(`  ✗ ${it.no} ${it.id} ${it.home || ''}: ${errs.join('；')}`);
  } else {
    const h = JSON.parse(readFileSync(hcPath, 'utf8'));
    console.log(`  ✓ ${it.no} ${it.id} ${it.home || ''}: hc=${h.hc} 大小=${h.ou} 大${h.live.over}/小${h.live.under}`);
  }
}

console.log(fails ? `[check_fetch] FAIL — ${fails} 场不完整` : `[check_fetch] PASS — ${items.length} 场采集齐全`);
process.exit(fails ? 3 : 0);
