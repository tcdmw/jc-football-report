#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
fetch_dqd_consensus.py — 懂球帝「专家」数据全量采集（专家方案分布 + 裁判 + 伤停 + 必发 + 冷门预警 + 欧亚对比 + AI 预测）

链路（纯 HTTP，不需要浏览器，赛前赛后都能跑）：
  1. GET https://m.dongqiudi.com/match/12?date=YYYY-MM-DD  （SSR 页面，含 li id="id<matchId>"）
  2. 正则解析 matchId + 主队 + 时间联赛 + 比分 + 客队，与 meta 对阵匹配
  3. GET https://lottery.dongqiudi.com/api/getMatchTips?match_id=<id>&mtoken=  → 23 个数据模块
  4. 落盘 <rawDir>/<titanId>.dqd_tips.json + <rawDir>/_dqd_consensus.json

用法：
  python tools/fetch_dqd_consensus.py <meta.json> <raw_dir> [--date 2026-11-16]
  例：python tools/fetch_dqd_consensus.py data/test/meta_1117_0345_5.json data/raw50

说明：
  - 日期页面规则与球探一致：北京时间凌晨场归属前一日。工具会对 kickoff 日期与其前一日各试一次。
  - getMatchTips 返回的 ExpertPlan 为「专家方案分布」（is_unlock=1），是已解锁可见的聚合统计，
    单条方案正文仍需付费，不绕过。
"""
import json
import os
import re
import sys
import time
import datetime

try:
    import requests
except ImportError:
    sys.exit("需要 requests（用 .runtime/python/python.exe 运行）")

UA = ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
      "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")
HDR = {"User-Agent": UA, "Referer": "https://m.dongqiudi.com/"}
SCHED = "https://m.dongqiudi.com/match/12?date={d}"
TIPS = "https://lottery.dongqiudi.com/api/getMatchTips?match_id={id}&mtoken="

# <li id="id54419581" class="match-calendar-item">
LI = re.compile(r'<li id="id(\d+)" class="match-calendar-item"')
TAGS = re.compile(r"<p(?:\s[^>]*)?>(.*?)</p>", re.S)
BLOCK_A = re.compile(r'<div class="match-item-a".*?</div>', re.S)
BLOCK_C = re.compile(r'<div class="match-item-c".*?</div>', re.S)
BLOCK_B = re.compile(r'<div class="match-item-b".*?</div>', re.S)


def clean(s):
    return re.sub(r"<[^>]+>|<!---->", "", s).replace("\n", " ").strip()


def ps_of(block):
    if not block:
        return []
    return [x for x in (clean(y) for y in TAGS.findall(block.group(0))) if x]


def parse_day(day):
    """解析某日赛程页 -> [{mid, home, away, kick, league, score}]"""
    try:
        r = requests.get(SCHED.format(d=day), headers=HDR, timeout=25)
        html = r.content.decode("utf-8", "ignore")
    except Exception as e:
        print(f"  [warn] {day} 赛程页获取失败: {e}")
        return []
    out = []
    for m in LI.finditer(html):
        mid = m.group(1)
        end = html.find("</li>", m.end())
        if end < 0:
            continue
        seg = html[m.end(): end]
        pa = ps_of(BLOCK_A.search(seg))
        pc = ps_of(BLOCK_C.search(seg))
        pb = ps_of(BLOCK_B.search(seg))
        if not pa or not pb:
            continue
        tm = re.search(r"(\d{1,2}:\d{2})\s*(.*)", pc[0]) if pc else None
        out.append({
            "mid": mid,
            "home": pa[-1],
            "away": pb[-1],
            "kick": tm.group(1) if tm else "",
            "league": (re.sub(r"<!---->", "", tm.group(2) or "")).strip() if tm else "",
            "score": next((x for x in pc if re.match(r"^\d+\s*-\s*\d+$", x)), ""),
        })
    return out


def norm(s):
    s = re.sub(r"[（(].*?[)）]", "", s or "")   # 去括号内容（如 "(中)"）
    return re.sub(r"[\s()（）·\-—*]", "", s)


def match_one(m, day_rows):
    nh, na = norm(m["home"]), norm(m["away"])
    for r in day_rows:
        if norm(r["home"]) == nh and norm(r["away"]) == na:
            return r
        if nh in norm(r["home"]) and na in norm(r["away"]):
            return r
    return None


MODULES = ["ExpertPlan", "Referee", "PersonAnalyse", "DarkAlarm", "OddsDiff",
           "TeamDesInjury", "TeamDesStrength", "Bf_Distribute", "Bf_Transaction",
           "Forecast", "GoalDistri", "AigcMatchPredictions", "KeyDes", "WsNews"]


def fetch_tips(mid):
    r = requests.get(TIPS.format(id=mid), headers=HDR, timeout=25)
    j = json.loads(r.content.decode("utf-8", "ignore"))
    d = j.get("data", {})
    arr = d.get("data", [])
    keep, plan = {}, None
    for it in arr:
        k = it.get("key")
        if k == "ExpertPlan":
            plan = it.get("data", {})
        if k in MODULES:
            keep[k] = it.get("data")
    dist = []
    if plan:
        for row in (plan.get("spread_data", {}) or {}).get("data", []):
            opts = []
            for i in (0, 1, 2):
                if row.get(f"rate{i}") is not None and row.get(f"rate{i}_desc"):
                    opts.append({"label": row[f"rate{i}_desc"], "rate": row[f"rate{i}"],
                                 "count": row.get(str(i))})
            dist.append({"play": row.get("play_type"), "count": row.get("count"), "options": opts})
    return {
        "planTotal": (plan or {}).get("spread_data", {}).get("count"),
        "planId": (plan or {}).get("plan_id"),
        "isUnlock": (plan or {}).get("is_unlock"),
        "price": (plan or {}).get("price"),
        "expertDist": dist,
        "modules": keep,
        "userId": d.get("user_id"),
        "vipType": d.get("vip_type"),
    }


def date_cands(kickoff):
    """返回候选日期页（含前一日）"""
    try:
        dt = datetime.datetime.strptime(kickoff.strip()[:16], "%Y-%m-%d %H:%M")
    except Exception:
        return []
    cands = [dt.date()]
    hh = dt.hour
    if hh < 12:
        cands.insert(0, dt.date() - datetime.timedelta(days=1))
    else:
        cands.append(dt.date() - datetime.timedelta(days=1))
    return [c.strftime("%Y-%m-%d") for c in cands]


def main():
    meta_path, raw_dir = sys.argv[1], sys.argv[2]
    forced = None
    if "--date" in sys.argv:
        forced = sys.argv[sys.argv.index("--date") + 1]
    meta = json.load(open(meta_path, encoding="utf-8"))
    os.makedirs(raw_dir, exist_ok=True)

    cache = {}
    index, miss = [], []
    for m in meta["matches"]:
        days = [forced] if forced else date_cands(m.get("kickoff", ""))
        row = None
        for d in days:
            if d not in cache:
                cache[d] = parse_day(d)
                print(f"  [day] {d}: {len(cache[d])} 场")
                time.sleep(0.6)
            row = match_one(m, cache[d])
            if row:
                break
        if not row:
            miss.append({"titanId": m["id"], "home": m["home"], "away": m["away"],
                         "kickoff": m.get("kickoff"), "tried": days})
            print(f"  [miss] {m['id']} {m['home']} vs {m['away']}")
            continue
        tips = fetch_tips(row["mid"])
        rec = {"titanId": m["id"], "dqdMatchId": row["mid"],
               "home": m["home"], "away": m["away"],
               "pageHome": row["home"], "pageAway": row["away"],
               "kickoff": row["kick"], "league": row["league"], "pageScore": row["score"],
               **tips}
        with open(os.path.join(raw_dir, f"{m['id']}.dqd_tips.json"), "w", encoding="utf-8") as f:
            json.dump(rec, f, ensure_ascii=False, indent=1)
        index.append({k: rec[k] for k in ("titanId", "dqdMatchId", "home", "away", "pageScore",
                                          "planTotal")})
        tops = " / ".join(f"{x['play']}:{x['count']}" for x in rec["expertDist"])
        print(f"  [ok] {m['id']} -> {row['mid']} ({row['home']} {row['score']} {row['away']}) plans={rec['planTotal']} | {tops}")
        time.sleep(0.8)

    with open(os.path.join(raw_dir, "_dqd_consensus.json"), "w", encoding="utf-8") as f:
        json.dump({"source": "dongqiudi_getMatchTips", "total": len(index),
                   "matched": index, "missed": miss}, f, ensure_ascii=False, indent=1)
    print(f"\n[fetch_dqd_consensus] 命中 {len(index)} 场 / 未命中 {len(miss)} 场 -> {raw_dir}/_dqd_consensus.json")


if __name__ == "__main__":
    main()
