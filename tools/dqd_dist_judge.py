# -*- coding: utf-8 -*-
"""解析方案页比分 + 对照盘口，检验懂球帝专家群体多数派是否命中"""
import json
import os
import re
import sys

BASE = r"C:\Users\Administrator\DoubaoWork\chats\2026-11-07\new-chat\jc-football-report-main"
sys.path.insert(0, os.path.join(BASE, "tools"))
from fetch_dqd_post import judge_handicap, judge_total

pages = json.load(open(os.path.join(BASE, "data", "dqd_intel", "plan_pages.json"), encoding="utf-8"))
rows = json.load(open(os.path.join(BASE, "data", "dqd_intel", "match_plan_dist.json"), encoding="utf-8"))

def score_of(t):
    for ln in t.split("\n"):
        s = ln.strip()
        if re.fullmatch(r"\d+\s*-\s*\d+", s):
            a, b = re.split(r"\s*-\s*", s)
            return int(a), int(b)
    return None

def odds_of(rec):
    raw = rec.get("raw")
    p = os.path.join(BASE, "data", raw, rec["tid"] + ".handicap.json")
    if not os.path.exists(p):
        return None, None
    d = json.load(open(p, encoding="utf-8"))
    hc = d.get("hc")
    live = d.get("live") or {}
    ou = live.get("ouLine")
    try:
        hc = float(hc) if hc is not None else None
    except Exception:
        hc = None
    try:
        ou = float(ou) if ou is not None else None
    except Exception:
        ou = None
    return hc, ou

out = []
for rec in rows:
    pid = str(rec.get("plan_id"))
    t = pages.get(pid, "")
    sc = score_of(t)
    hc, oul = odds_of(rec)
    dd = (rec.get("dist") or {}).get("data") or {}
    r = {"batch": rec["raw"], "tid": rec["tid"], "home": rec["home"], "away": rec["away"],
         "score": sc, "hc": hc, "ouLine": oul,
         "spf": dd.get("胜平负") or {}, "ou": dd.get("大小球") or {}, "ah": dd.get("亚盘") or {}}
    out.append(r)

def pick(dct):
    if not dct:
        return None
    a = dct.get("rate0") or 0
    b = dct.get("rate1") or 0
    c = dct.get("rate2") or 0
    if a >= b and a >= c:
        return "0"
    if c >= a and c >= b:
        return "2"
    return "1"

print("场次 | 比分 | 盘口 | 胜平负多数 | 实际 | 中 | 大小多数 | 线 | 实际 | 中 | 亚盘多数 | 中")
n_spf = n_ou = n_ah = 0
h_spf = h_ou = h_ah = 0
for r in out:
    if not r["score"]:
        continue
    gh, ga = r["score"]
    tot = gh + ga
    res = "0" if gh > ga else ("2" if gh < ga else "1")
    sp = pick(r["spf"])
    sp_ok = (sp == res) if sp else None
    if sp_ok is not None:
        n_spf += 1
        h_spf += 1 if sp_ok else 0

    ou_p = pick(r["ou"])
    out_ = judge_total(r["ouLine"], tot)
    ou_ok = None
    if ou_p and out_ != "走":
        want = "0" if ("大" in str(out_)) else "2"
        # judge_total 返回 "大"/"小"/"走" 或类似
        actual_dir = "0" if str(out_).startswith("大") or "大" in str(out_) else ("2" if "小" in str(out_) else None)
        ou_ok = (ou_p == actual_dir) if actual_dir else None
    if ou_ok is not None:
        n_ou += 1
        h_ou += 1 if ou_ok else 0

    ah_p = pick(r["ah"])
    ah_ok = None
    if ah_p and r["hc"] is not None and r["hc"] != 0:
        # 0 = 押主队，2 = 押客队；hc>0 主队让球（主=上盘），hc<0 客队让球（主=下盘）
        if ah_p == "0":
            side = "上盘" if r["hc"] > 0 else "下盘"
        elif ah_p == "2":
            side = "下盘" if r["hc"] > 0 else "上盘"
        else:
            side = None
        if side:
            r2 = judge_handicap(r["hc"], gh, ga, side)
            if r2 in ("赢", "输"):
                ah_ok = (r2 == "赢")
    if ah_ok is not None:
        n_ah += 1
        h_ah += 1 if ah_ok else 0

    print("%s-%s %s-%s | 比分%d-%d | hc=%s ou=%s | spf%s->%s %s | ou%s->%s %s | ah%s %s" % (
        r["batch"], r["tid"][-4:], r["home"], r["away"], gh, ga, r["hc"], r["ouLine"],
        sp, res, ("中" if sp_ok else "错") if sp_ok is not None else "-",
        ou_p, out_, ("中" if ou_ok else "错") if ou_ok is not None else "-",
        ah_p, ("中" if ah_ok else "错") if ah_ok is not None else "-"))

print("\n胜平负多数派: %d/%d = %.1f%%" % (h_spf, n_spf, (h_spf / n_spf * 100) if n_spf else 0))
print("大小球多数派: %d/%d = %.1f%%" % (h_ou, n_ou, (h_ou / n_ou * 100) if n_ou else 0))
print("亚盘多数派  : %d/%d = %.1f%%" % (h_ah, n_ah, (h_ah / n_ah * 100) if n_ah else 0))
json.dump(out, open(os.path.join(BASE, "data", "dqd_intel", "dist_judged.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)
