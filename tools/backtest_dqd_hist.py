# -*- coding: utf-8 -*-
"""backtest_dqd_hist.py — 回溯历史懂球帝专家方案分布并判定命中

数据来源：
  1) data/out/matchesN.json      -> titanId / no / home / away / source(原始 raw 目录)
  2) data/test/resultsN.json     -> (batch, no) -> [gh, ga]
  3) data/raw*/_dqd_consensus.json -> titanId + dqdMatchId（历史采集时存下的懂球帝场次 id）
  4) data/raw*/<titanId>.handicap.json -> hc / ouLine

对每个能配齐「dqdMatchId + 比分 + 盘口」的场次，重新调 getMatchTips 取 ExpertPlan，
再用比分与盘口逐项判定，最后汇总。

用法：
    .runtime\\python\\python.exe tools\\backtest_dqd_hist.py
"""
import glob
import json
import os
import re
import sys

import requests

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_dqd_consensus as F
from fetch_dqd_post import line_of, judge_handicap, judge_total, to_line


def plan_of(mid):
    """容错解析 getMatchTips：data 可能是 dict 也可能是 list"""
    try:
        r = requests.get(F.TIPS.format(id=mid), headers=F.HDR, timeout=25)
        j = json.loads(r.content.decode("utf-8", "ignore"))
    except Exception:
        return None
    d = j.get("data")
    arr = d if isinstance(d, list) else (d.get("data") if isinstance(d, dict) else None)
    if not isinstance(arr, list):
        return None
    plan = None
    for it in arr:
        if isinstance(it, dict) and it.get("key") == "ExpertPlan":
            plan = it.get("data") or {}
    if not plan:
        return None
    dist = []
    for row in ((plan.get("spread_data") or {}).get("data") or []):
        opts = []
        for i in (0, 1, 2):
            if row.get(f"rate{i}") is not None and row.get(f"rate{i}_desc"):
                opts.append({"label": row[f"rate{i}_desc"], "rate": row[f"rate{i}"],
                             "count": row.get(str(i))})
        dist.append({"play": row.get("play_type"), "count": row.get("count"), "options": opts})
    return dist


def batch_no(path):
    m = re.search(r"(\d+)\.json$", path)
    return m.group(1) if m else None


def raw_of(src):
    m = re.search(r"(raw\d+)", str(src or ""))
    return m.group(1) if m else None


def build_index():
    results = {}
    for p in glob.glob(os.path.join(BASE, "data", "test", "results*.json")):
        n = batch_no(p)
        try:
            d = json.load(open(p, encoding="utf-8"))
        except Exception:
            continue
        for no, sc in (d.get("results") or {}).items():
            results[(n, str(no))] = sc

    idx = {}
    for p in glob.glob(os.path.join(BASE, "data", "out", "matches*.json")):
        n = batch_no(p)
        try:
            d = json.load(open(p, encoding="utf-8"))
        except Exception:
            continue
        for m in d.get("matches") or []:
            idx[str(m["id"])] = {"batch": n, "no": str(m.get("no")),
                                 "home": m.get("home"), "away": m.get("away"),
                                 "raw": raw_of(d.get("source"))}
    return results, idx


def main():
    results, idx = build_index()
    rows = []
    tried = 0
    for p in sorted(glob.glob(os.path.join(BASE, "data", "raw*", "_dqd_consensus.json"))):
        try:
            d = json.load(open(p, encoding="utf-8"))
        except Exception:
            continue
        for mt in d.get("matched") or []:
            tid = str(mt.get("titanId"))
            mid = mt.get("dqdMatchId")
            if not mid or tid not in idx:
                continue
            meta = idx[tid]
            sc = results.get((meta["batch"], meta["no"]))
            if not sc:
                continue
            tried += 1
            gh, ga = sc
            hc_path = os.path.join(BASE, "data", meta["raw"] or "", f"{tid}.handicap.json")
            hc, ou_raw = line_of(hc_path)
            ou = to_line(ou_raw)
            try:
                dist = plan_of(mid)
            except Exception as e:
                print(f"[warn] {tid} plan 失败 {e}")
                continue
            if not dist:
                print(f"[skip] {tid} {meta['home']}-{meta['away']} 无 ExpertPlan")
                continue
            for row in dist:
                opts = row.get("options") or []
                if not opts:
                    continue
                top = max(opts, key=lambda o: o.get("rate") or 0)
                lab = top.get("label", "")
                if "总进球" in (row.get("play") or ""):
                    t = judge_total(ou, gh + ga)
                    res = "走" if t == "走" else ("对" if ("大" in lab) == (t == "大") else "错")
                    kind = "总进球"
                elif hc is not None:
                    r2 = judge_handicap(hc, gh, ga, "上盘" if "上盘" in lab else "下盘")
                    res = {"赢": "对", "输": "错", "走": "走", "?": "?"}.get(r2, "?")
                    kind = "让球"
                else:
                    continue
                rows.append({"batch": meta["batch"], "no": meta["no"], "tid": tid, "mid": mid,
                             "home": meta["home"], "away": meta["away"], "score": [gh, ga],
                             "hc": hc, "ou": ou, "play": row.get("play"), "kind": kind,
                             "label": lab, "rate": top.get("rate"), "count": top.get("count"),
                             "judge": res})
            print(f"[{meta['batch']}-{meta['no']}] {meta['home']} {gh}-{ga} {meta['away']} | hc={hc} ou={ou} | "
                  + " ; ".join(f"{r['kind']}:{r['label']}({r['rate']}%)->{r['judge']}" for r in rows[-len(dist):]))

    print(f"\n可配对场次 {tried}")
    out = os.path.join(BASE, "data", "test", "dqd_backtest.json")
    for k in ["总进球", "让球", None]:
        rs = [r for r in rows if (k is None or r["kind"] == k)]
        ok = sum(1 for r in rs if r["judge"] == "对")
        walk = sum(1 for r in rs if r["judge"] == "走")
        pct = ok / len(rs) * 100 if rs else 0
        print(f"{k or '合计':6}: 对 {ok}/{len(rs)} = {pct:.1f}%  (走 {walk})")
    json.dump({"rows": rows}, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("写出", out)


if __name__ == "__main__":
    main()
