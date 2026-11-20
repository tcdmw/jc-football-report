# -*- coding: utf-8 -*-
"""把懂球帝每场的专家方案分布与赛果对齐，验证 0/2 语义并算群体多数派命中"""
import glob
import json
import os
import re

BASE = r"C:\Users\Administrator\DoubaoWork\chats\2026-11-07\new-chat\jc-football-report-main"

# tid -> (batch, no)
idx = {}
for mp in glob.glob(os.path.join(BASE, "data", "out", "matches*.json")):
    mm = re.search(r"matches(\d+)\.json", mp)
    if not mm:
        continue
    n = mm.group(1)
    d = json.load(open(mp, encoding="utf-8"))
    for m in d.get("matches") or []:
        idx[str(m["id"])] = (n, str(m["no"]), m.get("home"), m.get("away"))

# (batch,no) -> 比分
scores = {}
for rp in glob.glob(os.path.join(BASE, "data", "out", "results*.json")):
    rm = re.search(r"results(\d+)\.json", rp)
    if not rm:
        continue
    n = rm.group(1)
    d = json.load(open(rp, encoding="utf-8"))
    for k, v in (d.get("results") or {}).items():
        scores[(n, str(k))] = v

rows = json.load(open(os.path.join(BASE, "data", "dqd_intel", "match_plan_dist.json"), encoding="utf-8"))
out = []
print("场次  比分      胜平负(0/1/2)      大小球(0/2)     亚盘(0/2)")
for r in rows:
    tid = r["tid"]
    b, no, h, a = idx.get(tid, ("?", "?", r["home"], r["away"]))
    sc = scores.get((b, no))
    dd = (r.get("dist") or {}).get("data") or {}
    spf = dd.get("胜平负") or {}
    ou = dd.get("大小球") or {}
    ah = dd.get("亚盘") or {}
    line = []
    line.append(f"[{b}-{no}] {h} vs {a}")
    line.append(f"score={'%d-%d' % (sc[0], sc[1]) if sc else '--'}")
    if spf:
        line.append("spf=%s/%s/%s(n%s)" % (spf.get("rate0"), spf.get("rate1"), spf.get("rate2"), spf.get("count")))
    if ou:
        line.append("ou=%s大/%s小(n%s)" % (ou.get("rate0"), ou.get("rate2"), ou.get("count")))
    if ah:
        line.append("ah=%s/%s(n%s)" % (ah.get("rate0"), ah.get("rate2"), ah.get("count")))
    print(" ".join(line))
    out.append({"batch": b, "no": no, "home": h, "away": a, "score": sc, "spf": spf, "ou": ou, "ah": ah,
                "count": (r.get("dist") or {}).get("count")})

json.dump(out, open(os.path.join(BASE, "data", "dqd_intel", "dist_with_score.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)
print("\n有比分场次:", sum(1 for x in out if x["score"]), "/", len(out))
