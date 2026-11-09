#!/usr/bin/env node
// tools/collect.mjs — 原始球探分析页 → matches.json
// 规则：赔率串用 DP 切分并加合规约束（spf margin 12.5%–15.5%）；无合规解返回 null 并记原因，绝不臆造。
// 用法: node tools/collect.mjs <rawDir> <meta.json> [out.json]

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const req = createRequire(import.meta.url);
const A = req('../scripts/analyze.js'); // 复用模型拟合，做赔率串一致性判据

const RAW = process.argv[2] || 'data/raw';
const META = process.argv[3] || 'data/test/meta.json';
const OUT = process.argv[4] || 'data/out/matches.json';

const HCP = {
  '平手': 0, '平手/半球': 0.25, '半球': 0.5, '半球/一球': 0.75, '半/一': 0.75,
  '一球': 1.0, '一球/球半': 1.25, '球半': 1.5, '球半/两球': 1.75,
  '两球': 2.0, '两球/两球半': 2.25, '两球半': 2.5, '两球半/三球': 2.75, '三球': 3.0,
};

// ---------- 赔率串 DP 切分 ----------
function cuts(s, n) {
  const out = [];
  // 页面会把整十赔率写成整数（3.00→"3"、5.00→"5"），故允许无小数点 token
  const re = /^\d{1,3}(?:\.\d{1,2})?$/;
  const parts = [];
  (function rec(pos) {
    if (parts.length === n) {
      if (pos === s.length) out.push(parts.slice());
      return;
    }
    for (let len = 1; len <= 7 && pos + len <= s.length; len++) {
      const tok = s.slice(pos, pos + len);
      if (!re.test(tok)) continue;
      const v = parseFloat(tok);
      if (!(v >= 1.0 && v <= 600)) continue;
      parts.push(v); rec(pos + len); parts.pop();
    }
  })(0);
  return out;
}

function marginOf(odds) { return odds.reduce((a, o) => a + 1 / o, 0) - 1; }

function parseSPF(str) {
  const s = String(str || '').trim();
  if (!s) return { spf: null, reason: '空串' };
  if (/^0{2,}$/.test(s)) return { spf: null, jcNotOpen: true, reason: '页面为 000，竞彩未开' };
  const cands = cuts(s, 3).filter(o => { const m = marginOf(o); return m >= 0.125 && m <= 0.155; });
  if (cands.length === 1) return { spf: cands[0], margin: marginOf(cands[0]) };
  return { spf: null, reason: `合规解 ${cands.length} 个（需唯一）`, cands };
}

function parseZJQ(str, spf) {
  const s = String(str || '').trim();
  if (!s) return { zjq: null, reason: '空串' };
  const all = cuts(s, 8);
  // 形状约束：谷底在 2–4 球，谷底前不增、谷底后不减；档位值域与隐含概率和双双收紧
  const shaped = all.filter(o => {
    if (o.some(v => v < 1.5 || v > 80)) return false;
    const minIdx = o.indexOf(Math.min(...o));
    if (minIdx < 2 || minIdx > 4) return false;
    for (let i = 1; i <= minIdx; i++) if (o[i] > o[i - 1] + 1e-9) return false;
    for (let i = minIdx + 1; i < 8; i++) if (o[i] < o[i - 1] - 1e-9) return false;
    const sum = o.reduce((a, v) => a + 1 / v, 0);
    return sum >= 1.18 && sum <= 1.38;
  });
  if (shaped.length === 1) return { zjq: shaped[0] };
  if (shaped.length > 1) {
    // 一致性判据：候选隐含 λ 必须接近胜平负拟合出的 λ（同场两套玩法应指向同一期望进球）
    if (spf) {
      let ref = null;
      try { ref = A.fit2D(spf).lambdaTotal; } catch { ref = null; }
      if (ref && ref > 0) {
        const scored = shaped.map(o => {
          let lam = null;
          try { lam = A.fitFromZJQ(o, spf).lambdaTotal; } catch { lam = null; }
          if (!lam) return { o, d: Infinity };
          return { o, d: Math.abs(Math.log(lam / ref)) };
        }).sort((a, b) => a.d - b.d);
        const best = scored[0], second = scored[1];
        if (best.d < 0.06 && best.d < second.d - 0.005) {
          return { zjq: best.o, ambiguous: shaped.length, lambdaGap: best.d };
        }
        return { zjq: null, reason: `一致解不唯一（最优 ${best.d.toFixed(3)} vs ${second.d.toFixed(3)}，${shaped.length} 候）` };
      }
    }
    const score = (o) => {
      const mn = Math.min(...o);
      return (o[0] / mn) + (o[7] / mn) + (o.reduce((a, v) => a + Math.log(v), 0) / 8);
    };
    const scored = shaped.map(o => ({ o, s: score(o) })).sort((a, b) => b.s - a.s);
    if (scored.length >= 2 && Math.abs(scored[0].s - scored[1].s) < 1e-9) {
      return { zjq: null, reason: `形状解 ${shaped.length} 个且并列`, cands: shaped };
    }
    return { zjq: scored[0].o, ambiguous: shaped.length };
  }
  return { zjq: null, reason: `无形状合规解（候选 ${all.length}）` };
}

function parseHC(str) {
  const s = String(str || '').trim();
  if (!s) return { hc: null, reason: '无初盘' };
  const neg = /^受让/.test(s);
  const key = s.replace(/^受让/, '');
  if (!(key in HCP)) return { hc: null, reason: `未识别盘口「${s}」` };
  return { hc: neg ? -HCP[key] : HCP[key], raw: s };
}

// ---------- 积分排名段 ----------
function nums(line) { return (line.match(/-?\d+/g) || []).map(Number); }

function parseTeam(txt) {
  const lines = txt.split(/\r?\n/);
  const start = lines.findIndex(l => l.includes('联赛积分排名'));
  if (start < 0) return { team: null, reason: '无联赛积分排名段' };
  const teams = [];
  for (let i = start + 1; i < lines.length && teams.length < 2; i++) {
    const m = lines[i].match(/^\[(.+?)-(\d+)\](.+)$/);
    if (!m) continue;
    const lg = m[1], name = m[3].trim();
    const rows = {};
    let overall = null;
    let j = i + 1;
    for (; j < lines.length && Object.keys(rows).length < 4; j++) {
      const l = lines[j];
      const tag = l.match(/^(总|主|客|近6)\t/);
      if (!tag) continue;
      const body = l.slice(l.indexOf('\t') + 1);
      const v = nums(body);
      if (v.length < 6) continue;
      rows[tag[1]] = { p: v[0], gf: v[4], ga: v[5] };
      if (tag[1] === '总') {
        // 整体实力：赛 胜 平 负 得 失 净 积分 排名 胜率%
        const pctM = body.match(/([\d.]+)\s*%/);
        overall = {
          p: v[0], w: v[1], d: v[2], l: v[3], gf: v[4], ga: v[5], gd: v[6],
          points: v[7], rank: v[8], winRate: pctM ? parseFloat(pctM[1]) : null,
        };
      }
    }
    teams.push({ lg, name, rows, overall });
    i = j;
  }
  if (teams.length < 2) return { team: null, reason: `积分段队数 ${teams.length}` };
  const [h, a] = teams;
  const need = (t) => t.rows['主'] && t.rows['客'] && t.rows['近6'];
  if (!need(h) || !need(a)) return { team: null, reason: '主/客/近6 行不全' };
  return {
    team: {
      overall: { home: h.overall, away: a.overall },
      home: { home: h.rows['主'], away: h.rows['客'] },
      away: { home: a.rows['主'], away: a.rows['客'] },
      form: { home: h.rows['近6'], away: a.rows['近6'] },
      leagueOf: { home: h.lg, away: a.lg },
    },
  };
}

// ---------- 赛程体能：rest_days（本场 - 各队最近一场） ----------
const REST_DATE_RE = /^\d{2}-\d{2}-\d{2}$/;

function parseRestDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(2000 + y, m - 1, d);
}

// 从「近期战绩」段按主、客两个队名标题，取各自最近一场比赛日期，算到 kickoff 的间隔天。
// 返回 {home, away}；缺日期或无法定位时对应字段为 null，绝不臆造。
function parseRestDays(txt, kickoff) {
  const lines = txt.split(/\r?\n/);
  const start = lines.findIndex(l => l.includes('近期战绩'));
  if (start < 0) return { home: null, away: null, reason: '无近期战绩段' };
  const titleIdx = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l && !l.includes('\t') && !/^\d+$/.test(l) && l.length < 12
        && !/^(近|主|盘口|类型|全场|半场|初|终|胜平负)/.test(l)
        && (lines[i + 1] || '').trim() === '近') {
      titleIdx.push(i);
    }
    if (titleIdx.length >= 2) break;
  }
  if (titleIdx.length < 2) return { home: null, away: null, reason: '主客队名标题不足' };
  const kick = new Date(String(kickoff).replace(' ', 'T'));
  const days = titleIdx.map(ti => {
    const to = titleIdx.includes(ti) && titleIdx.indexOf(ti) + 1 < titleIdx.length
      ? titleIdx[titleIdx.indexOf(ti) + 1] : lines.length;
    for (let i = ti; i < to; i++) {
      const dcol = lines[i].split('\t').map(x => x.trim()).find(x => REST_DATE_RE.test(x));
      if (dcol) {
        return Math.round((kick - parseRestDate(dcol)) / 86400000);
      }
    }
    return null;
  });
  return { home: days[0], away: days[1] };
}

// ---------- 主流程 ----------
const meta = JSON.parse(readFileSync(META, 'utf8'));
const items = meta.matches || meta;
const matches = [];
const issues = [];

for (const it of items) {
  const file = join(RAW, `${it.id}.txt`);
  if (!existsSync(file)) { issues.push({ no: it.no, id: it.id, issue: '缺 raw 文件' }); continue; }
  const txt = readFileSync(file, 'utf8');
  const lines = txt.split(/\r?\n/);

  // 队名校验（页面首部：主队(主) / 客队）
  const homeTag = (txt.match(/^(.+?)\(主\)$/m) || [])[1];
  const homeOk = homeTag && (homeTag.includes(it.home) || it.home.includes(homeTag));

  // 竞彩区：胜平负/亚让 之后第一行"全场\t<串>"
  const jcIdx = lines.findIndex(l => l.includes('竞足数据'));
  let spfRaw = null, rqRaw = null;
  if (jcIdx >= 0) {
    const next1 = (lines[jcIdx + 1] || '').trim();
    if (next1.includes('暂无数据')) {
      // 竞彩未开盘（日职乙常见）。直接标记，不向后找，否则会误匹配积分段的"全场 赛"表头
      spfRaw = null;
    } else {
      for (let i = jcIdx; i < Math.min(jcIdx + 6, lines.length); i++) {
        const m = lines[i].match(/^全场\t\s*(\S+)/);
        if (m) { spfRaw = m[1]; rqRaw = (lines[i + 1] || '').trim().split(/\t/)[0] || null; break; }
      }
    }
  }
  const spfRes = spfRaw
    ? parseSPF(spfRaw)
    : (jcIdx >= 0 && (lines[jcIdx + 1] || '').includes('暂无数据')
        ? { spf: null, jcNotOpen: true, reason: '竞彩暂无数据，未开盘' }
        : { spf: null, reason: '未定位竞彩行' });

  // 进球数 8 串：紧跟在「0球1球…7+球」标签行之后的下一行，取第 2 列
  let zjqRaw = null;
  if (jcIdx >= 0) {
    let tagIdx = -1;
    for (let i = jcIdx; i < Math.min(jcIdx + 6, lines.length); i++) {
      if (lines[i].includes('0球1球')) { tagIdx = i; break; }
    }
    if (tagIdx >= 0) {
      const cols = (lines[tagIdx + 1] || '').split('\t').map(x => x.trim()).filter(Boolean);
      zjqRaw = cols.length >= 2 ? cols[cols.length - 1] : null;
    }
  }
  const zjqRes = zjqRaw ? parseZJQ(zjqRaw, spfRes.spf) : { zjq: null, reason: '未定位进球数串' };

  // 亚盘：只认结构化当前盘口（抓取阶段旁路文件 {id}.handicap.json）。
  // 禁止用 /初盘:/ 正则——body innerText 里的“初盘:受让…”位于“相同盘路”历史统计区，会把当前主让误判成受让。
  const hcFile = join(RAW, `${it.id}.handicap.json`);
  let hcRes;
  if (existsSync(hcFile)) {
    const hcp = JSON.parse(readFileSync(hcFile, 'utf8'));
    hcRes = { hc: hcp.hc, raw: hcp.raw || null };
  } else {
    hcRes = { hc: null, reason: '无结构化当前盘口（innerText 仅含相同盘路区历史标签，禁止外推方向）' };
  }

  // 积分段
  const tmRes = parseTeam(txt);

  // 赛程体能 rest_days（基于近期战绩日期，工具计算，非手算）
  const rest = parseRestDays(txt, it.kickoff);

  // 懂球帝情报（伤停 + 必发真实资金），来自 {id}.dqd.json；缺失则为 null
  const dqdFile = join(RAW, `${it.id}.dqd.json`);
  let dqdIntel = null;
  if (existsSync(dqdFile)) {
    const d = JSON.parse(readFileSync(dqdFile, 'utf8'));
    dqdIntel = {
      injuries: d.injuries || [],
      betfairComment: d.betfairComment || '',
      betfair: d.betfair || [],
      bigTrend: d.bigTrend || {},
    };
  }

  // 完场比分（赛后页面才有）
  const scoreM = txt.match(/(\d+)[\r\n]+完[\r\n]+\((\d+)-(\d+)\)[\r\n]+(\d+)/);

  const row = {
    no: it.no, id: it.id, lg: it.lg, kickoff: it.kickoff,
    home: it.home, away: it.away,
    hc: hcRes.hc, hcRaw: hcRes.raw || null,
    spf: spfRes.spf, spfMargin: spfRes.margin ?? null,
    zjq: zjqRes.zjq, zjqRaw,
    jcNotOpen: !!spfRes.jcNotOpen,
    team: tmRes.team,
    restDays: { home: rest.home, away: rest.away },
    dqdIntel,
    liveScore: scoreM ? [Number(scoreM[1]), Number(scoreM[4])] : null,
    halfScore: scoreM ? [Number(scoreM[2]), Number(scoreM[3])] : null,
    checks: {},
  };
  row.checks = {
    homeTagOk: !!homeOk,
    spf: spfRes.spf ? 'ok' : (spfRes.reason || 'null'),
    zjq: zjqRes.zjq ? 'ok' : (zjqRes.reason || 'null'),
    hc: hcRes.hc !== null ? 'ok' : hcRes.reason,
    team: tmRes.team ? 'ok' : tmRes.reason,
  };
  if (!homeOk) {
    issues.push({ no: it.no, id: it.id, issue: '队名与页面不符', page: homeTag });
  }
  matches.push(row);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ source: RAW, collectedAt: new Date().toISOString(), count: matches.length, issues, matches }, null, 1), 'utf8');

const st = {
  total: matches.length,
  spf: matches.filter(m => m.spf).length,
  jcNotOpen: matches.filter(m => m.jcNotOpen).length,
  zjq: matches.filter(m => m.zjq).length,
  hc: matches.filter(m => m.hc !== null).length,
  team: matches.filter(m => m.team).length,
  score: matches.filter(m => m.liveScore).length,
};
console.log(`[collect] ${st.total} 场 | spf ${st.spf} | 未开 ${st.jcNotOpen} | 进球数 ${st.zjq} | 让球 ${st.hc} | 独立输入 ${st.team} | 页面比分 ${st.score}`);
for (const m of matches) {
  if (!m.spf && !m.jcNotOpen) console.log(`  ! ${m.no} ${m.home}: spf 解析失败 — ${m.checks.spf}`);
  if (!m.zjq) console.log(`  ! ${m.no} ${m.home}: 进球数解析失败 — ${m.checks.zjq}`);
  if (m.hc === null) console.log(`  ! ${m.no} ${m.home}: 让球 — ${m.checks.hc}`);
  if (!m.team) console.log(`  ! ${m.no} ${m.home}: 独立输入 — ${m.checks.team}`);
}
for (const i of issues) console.log(`  ! 数据问题 ${i.no}/${i.id}: ${i.issue}${i.page ? ' 页面=' + i.page : ''}`);
process.exitCode = (st.spf === 0 && st.team === 0) ? 3 : 0;
