#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""fetch_dqd_post.py — 懂球帝「专家方案分布」赛后采集与判定

懂球帝 `getMatchTips` 的 ExpertPlan 模块，是**该场全部专家方案的聚合统计**
（本批两场分别 79 / 95 条方案，is_unlock=1 免费可见），字段：
  spread_data.data[] = [{play_type, count, 0/1/2=票数, rate0/1/2=占比, rate0/1/2_desc=选项名}]

本脚本按 meta + raw 采集每场分布，并**用真实比分与盘口逐项判定对错**，作为复盘的
独立第三方参照（与球探分析师方案 fetch_post_plans.py 互补）。

用法（requests 直连，不需要浏览器）：
    .runtime\\python\\python.exe tools\\fetch_dqd_post.py <meta.json> <rawDir> <out.json>
    python tools/fetch_dqd_post.py data/test/meta_1119_0145_ou2.json data/raw56 data/test/post_dqd57.json

判定口径（不做任何手算，全部由盘口与比分机械推导）：
  让球：hc>0 主让（上盘=主），hc<0 客让（上盘=客）；
        上盘净胜 = (主-客 与 hc 同向时) diff - |hc|；>0 上盘赢，=0 走，<0 上盘输；下盘相反。
  大小：总进球 vs ouLine（复合盘 3.5/4 记 3.75）；>线 大，=线 走，<线 小。
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_dqd_consensus as F


def line_of(hc_path):
    try:
        d = json.load(open(hc_path, encoding="utf-8"))
    except Exception:
        return None, None
    hc = d.get("hc")
    ou = (d.get("live") or {}).get("ouLine")
    return hc, ou


def judge_handicap(hc, gh, ga, side):
    """side: '上盘' / '下盘'"""
    diff = gh - ga
    if hc is None:
        return "?"
    if hc > 0:
        up_margin = diff - hc
    elif hc < 0:
        up_margin = (-diff) - abs(hc)
    else:
        up_margin = diff
    up = "赢" if up_margin > 0 else ("走" if up_margin == 0 else "输")
    if side == "上盘":
        return up
    if up == "赢":
        return "输"
    if up == "输":
        return "赢"
    return "走"


def judge_total(ou, total):
    if ou is None:
        return "?"
    if total > ou:
        return "大"
    if total == ou:
        return "走"
    return "小"


def to_line(s):
    """'3.5/4' -> 3.75"""
    if s is None:
        return None
    if isinstance(s, (int, float)):
        return float(s)
    parts = [float(x) for x in str(s).replace("／", "/").split("/") if x.strip()]
    return sum(parts) / len(parts) if parts else None


def run(meta_path, raw_dir, out_path):
    meta = json.load(open(meta_path, encoding="utf-8"))
    days = sorted({str(m["kickoff"])[:10] for m in meta["matches"]})
    rows = []
    for d in days:
        rows += F.parse_day(d)
        prev = str(int(d[-2:]) - 1)
        # 跨月不处理，本批 11-19 的前一日 11-18 已显式包含在 meta 的日期集内
    print(f"[dqd_post] 赛程候选 {len(rows)} 场")

    items = []
    for m in meta["matches"]:
        hit = None
        nh, na = F.norm(m["home"]), F.norm(m["away"])
        for r in rows:
            if nh in F.norm(r["home"]) and na in F.norm(r["away"]):
                hit = r
                break
        if not hit:
            print(f"[dqd_post] {m['home']} vs {m['away']} 未匹配到懂球帝场次，跳过")
            items.append({"no": m.get("no"), "id": str(m["id"]), "matched": False})
            continue
        tips = F.fetch_tips(hit["mid"])
        hc, ou_raw = line_of(os.path.join(raw_dir, f"{m['id']}.handicap.json"))
        ou = to_line(ou_raw)
        score = hit.get("score", "")
        try:
            gh, ga = [int(x.strip()) for x in score.split("-")]
        except Exception:
            gh = ga = None
        total = (gh + ga) if gh is not None else None
        judged = []
        for row in tips.get("expertDist", []):
            for o in row.get("options", []):
                lab = o.get("label", "")
                res = "?"
                if gh is not None and "总进球" in (row.get("play") or ""):
                    res = judge_total(ou, total)
                    if res == "大":
                        res = "对" if "大" in lab else "错"
                    elif res == "小":
                        res = "对" if "小" in lab else "错"
                    else:
                        res = "走"
                elif gh is not None and hc is not None:
                    r2 = judge_handicap(hc, gh, ga, "上盘" if "上盘" in lab else "下盘")
                    res = {"赢": "对", "输": "错", "走": "走", "?": "?"}.get(r2, "?")
                judged.append({"play": row.get("play"), "label": lab, "count": o.get("count"),
                               "rate": o.get("rate"), "judge": res})
        items.append({
            "no": m.get("no"), "id": str(m["id"]), "mid": hit["mid"],
            "dqdHome": hit["home"], "dqdAway": hit["away"], "matched": True,
            "planTotal": tips.get("planTotal"), "isUnlock": tips.get("isUnlock"),
            "hc": hc, "ouLine": ou, "ouRaw": ou_raw, "score": [gh, ga],
            "judged": judged,
        })
        print(f"[dqd_post] {hit['home']} vs {hit['away']} | {score} | 方案 {tips.get('planTotal')} 条")
        for j in judged:
            print(f"   {j['play']:6} {j['label']:4} {str(j['rate']):>3}% ({j['count']:>2}票) -> {j['judge']}")

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    json.dump({"collectedAt": __import__("time").strftime("%Y-%m-%dT%H:%M:%S"),
               "source": "dongqiudi_getMatchTips_ExpertPlan",
               "role": "sentiment_only",
               "roleNote": "共识只作情绪参考：不参与方向/让球/大小球判断，也不做反向信号",
               "items": items},
              open(out_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"[dqd_post] 写出 {out_path}")


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print(__doc__)
        sys.exit(2)
    run(sys.argv[1], sys.argv[2], sys.argv[3])
