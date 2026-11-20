# -*- coding: utf-8 -*-
"""懂球帝 TeamDesInjury -> injuryAdj

用法: python tools/fetch_dqd_injury.py 57 [56 55 ...]
读 data/out/matchesN.json，按 _dqd_consensus.json 的 titanId->dqdMatchId 映射取伤停，
解析成 {home, away} 的 lambda 修正量写回 matchesN.json，并在 data/test/injuryN.json 留审计明细。

口径（保守、可解释）：
- 位置权重: 前锋0.55 中场0.40 后卫0.28 门将0.18
- 出场权重: min(出场,12)/12
- 产出加成: 1 + 0.12*(进球+助攻)
- 伤缺=全额，成疑=半额
- 净差 = 0.30*(客队缺阵分 - 主队缺阵分)，双方各取 ±，夹在 ±0.35
"""
import json
import os
import re
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(BASE, "tools"))
import requests  # noqa: E402
from fetch_dqd_consensus import HDR, TIPS  # noqa: E402

POS_W = {"前锋": 0.55, "中场": 0.40, "后卫": 0.28, "门将": 0.18}
K_NET = 0.30
CAP = 0.35


def clamp(x, lo, hi):
    return max(lo, min(hi, x))


def parse_team(entries):
    """entries: [{content, label}] -> (deficit, detail[])"""
    deficit = 0.0
    detail = []
    for e in entries or []:
        content = str(e.get("content") or "")
        if "因伤不能上场" in content:
            status, factor = "out", 1.0
        elif "出战成疑" in content:
            status, factor = "doubt", 0.5
        else:
            continue
        for m in re.finditer(r"([^\s，。、（）,]{2,20})（([^）]*)）", content):
            name, meta = m.group(1), m.group(2)
            pos = next((p for p in POS_W if p in meta), None)
            if not pos:
                continue
            app = re.search(r"出场(\d+)", meta)
            gol = re.search(r"进球(\d+)", meta)
            ast = re.search(r"助攻(\d+)", meta)
            a = int(app.group(1)) if app else 6
            g = int(gol.group(1)) if gol else 0
            s = int(ast.group(1)) if ast else 0
            unit = POS_W[pos] * (min(a, 12) / 12.0) * (1 + 0.12 * (g + s))
            deficit += unit * factor
            detail.append({"name": name, "pos": pos, "app": a, "goal": g, "assist": s,
                           "status": status, "unit": round(unit * factor, 3)})
    return deficit, detail


def split_att_def(detail):
    """前锋/中场缺阵 -> 削弱己方进攻；后卫/门将缺阵 -> 削弱己方防守（等同抬高对手进攻）"""
    att = sum(d["unit"] for d in detail if d["pos"] in ("前锋", "中场"))
    deff = sum(d["unit"] for d in detail if d["pos"] in ("后卫", "门将"))
    return round(att, 3), round(deff, 3)


def tips_of(mid):
    r = requests.get(TIPS.format(id=mid), headers=HDR, timeout=25)
    return json.loads(r.content.decode("utf-8", "ignore"))


def main(argv):
    batches = []
    matches_override = None
    consensus_override = None
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--matches" and i + 1 < len(argv):
            matches_override = argv[i + 1]
            i += 2
        elif a == "--consensus" and i + 1 < len(argv):
            consensus_override = argv[i + 1]
            i += 2
        else:
            batches.append(a)
            i += 1

    if not batches and matches_override:
        batches = ["auto"]

    report = {}
    for n in batches:
        mp = matches_override or os.path.join(BASE, "data", "out", "matches%s.json" % n)
        if not os.path.exists(mp):
            print("[skip] 缺 matches%s.json" % n)
            continue
        payload = json.load(open(mp, encoding="utf-8"))
        matches = payload.get("matches") or []
        src = str(payload.get("source") or "")
        raw = os.path.basename(src.strip().strip("/")) or ("raw%s" % n)
        cp = consensus_override or os.path.join(BASE, "data", raw, "_dqd_consensus.json")
        mids = {}
        if os.path.exists(cp):
            d = json.load(open(cp, encoding="utf-8"))
            for mt in d.get("matched") or []:
                if mt.get("dqdMatchId"):
                    mids[str(mt.get("titanId"))] = str(mt.get("dqdMatchId"))

        detail_rows = []
        got = 0
        for m in matches:
            tid = str(m.get("id"))
            mid = mids.get(tid)
            rec = {"no": m.get("no"), "home": m.get("home"), "away": m.get("away"), "mid": mid}
            if not mid:
                rec["note"] = "无懂球帝 mid 映射"
                m["injuryAdj"] = {"home": 0, "away": 0, "source": "none", "reason": "无 mid"}
                detail_rows.append(rec)
                continue
            try:
                d = tips_of(mid)
                inj = None
                for it in d["data"]["data"]:
                    if isinstance(it, dict) and it.get("key") == "TeamDesInjury":
                        inj = it.get("data") or {}
                if not inj or (not inj.get("team_A") and not inj.get("team_B")):
                    rec["note"] = "无伤停数据"
                    m["injuryAdj"] = {"home": 0, "away": 0, "source": "empty"}
                    detail_rows.append(rec)
                    continue
                dh, det_h = parse_team(inj.get("team_A"))
                da, det_a = parse_team(inj.get("team_B"))
                att_h, def_h = split_att_def(det_h)
                att_a, def_a = split_att_def(det_a)
                # 主队 λ：己方进攻损失为负，对手防守缺口为正（对手缺后卫 -> 主队更容易进）
                adj_home = clamp(K_NET * (def_a - att_h), -CAP, CAP)
                adj_away = clamp(K_NET * (def_h - att_a), -CAP, CAP)
                m["injuryAdj"] = {
                    "home": round(adj_home, 3), "away": round(adj_away, 3), "source": "dqd",
                    "deficit": {"home": round(dh, 3), "away": round(da, 3)},
                    "split": {"home": {"att": att_h, "def": def_h},
                              "away": {"att": att_a, "def": def_a}},
                }
                rec.update({"deficitHome": round(dh, 3), "deficitAway": round(da, 3),
                            "attDefHome": {"att": att_h, "def": def_h},
                            "attDefAway": {"att": att_a, "def": def_a},
                            "home": det_h, "away": det_a})
                got += 1
            except Exception as e:
                rec["note"] = "抓取失败: %s" % type(e).__name__
                m["injuryAdj"] = {"home": 0, "away": 0, "source": "error"}
            detail_rows.append(rec)

        json.dump(payload, open(mp, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        out = os.path.join(BASE, "data", "test", "injury%s.json" % n)
        json.dump(detail_rows, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        report[n] = {"matches": len(matches), "withInjury": got, "detail": out}
        print("[batch %s] %d 场, 有伤停 %d 场 -> %s" % (n, len(matches), got, out))
    print(json.dumps(report, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main(sys.argv[1:] or ["57"])
