# -*- coding: utf-8 -*-
"""factcheck.py — 交付前事实核对（赛前报告必跑）

用法:
  python tools/factcheck.py <batchNo> [--raw data/rawNN] [--matches data/out/matchesN.json] [--preds data/out/predsN.json]

做三件事：
  1. 从源文件重新取一遍所有会被写进报告的数字（欧赔/让球/多公司退升盘/球队战绩/双轨概率/λ/比分）
  2. 校验 engine 文件是否本批（按 home/away 队名比对，不靠文件名）
  3. 打印成清单，供逐项回填报告

铁律：报告里的每个数字必须能在本清单里找到同名同值；找不到就不许写。
"""
import json
import os
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def main(argv):
    if not argv:
        print(__doc__)
        sys.exit(2)
    n = argv[0]
    raw = os.path.join(BASE, "data", "raw%s" % (int(n) - 1))
    matches_p = os.path.join(BASE, "data", "out", "matches%s.json" % n)
    preds_p = os.path.join(BASE, "data", "out", "preds%s.json" % n)
    engine_p = os.path.join(BASE, "data", "out", "engine_preds%s.json" % n)

    for flag, target in (("--raw", "raw"), ("--matches", "matches_p"), ("--preds", "preds_p")):
        if flag in argv:
            i = argv.index(flag)
            if i + 1 < len(argv):
                val = argv[i + 1]
                if target == "raw":
                    raw = os.path.join(BASE, val) if not os.path.isabs(val) else val
                elif target == "matches_p":
                    matches_p = os.path.join(BASE, val) if not os.path.isabs(val) else val
                else:
                    preds_p = os.path.join(BASE, val) if not os.path.isabs(val) else val

    M = load(matches_p)
    P = load(preds_p)["preds"]
    E = load(engine_p) if os.path.exists(engine_p) else None
    Eitems = ((E.get("preds") or E.get("matches") or []) if E else [])

    problems = []
    print("== batch %s  报告事实清单 ==" % n)
    print("raw=%s\nmatches=%s\npreds=%s\nengine=%s\n" % (
        os.path.relpath(raw, BASE), os.path.relpath(matches_p, BASE),
        os.path.relpath(preds_p, BASE), os.path.relpath(engine_p, BASE) if E else "缺失"))

    for m, p in zip(M["matches"], P):
        mid = str(m["id"])
        print("[%s] %s vs %s" % (m["no"], m["home"], m["away"]))
        print("  澳门让球 hc=%s（%s）  竞彩spf=%s" % (m.get("hc"), m.get("hcRaw"), m.get("spf")))

        f1x2 = os.path.join(raw, mid + ".1x2.json")
        if os.path.exists(f1x2):
            d = load(f1x2)
            o, l = d.get("openAvg", {}), d.get("liveAvg", {})
            print("  欧赔 初 %.2f/%.2f/%.2f -> 即时 %.2f/%.2f/%.2f  | 隐含主胜 %.2f%% -> %.2f%%" % (
                o.get("h", 0), o.get("d", 0), o.get("a", 0),
                l.get("h", 0), l.get("d", 0), l.get("a", 0),
                o.get("ph", 0), l.get("ph", 0)))
        else:
            problems.append("%s 缺 1x2" % mid)

        fhc = os.path.join(raw, mid + ".handicap.json")
        if os.path.exists(fhc):
            d = load(fhc)
            op, lv = d.get("open", {}), d.get("live", {})
            print("  澳门 让球 初 %s -> 即时 %s | 大小 初 %s -> 即时 %s | over %s / under %s" % (
                op.get("hc"), lv.get("hc"), op.get("ouLine"), lv.get("ouLine"),
                lv.get("over"), lv.get("under")))
        else:
            problems.append("%s 缺 handicap" % mid)

        fline = os.path.join(raw, mid + ".line.json")
        if os.path.exists(fline):
            d = load(fline)
            rows = d.get("lines") or []
            up = dn = flat = 0
            lives = []
            opens = []
            for r in rows:
                try:
                    oh, lh = float(r.get("openHc")), float(r.get("liveHc"))
                except (TypeError, ValueError):
                    continue
                lives.append(lh)
                opens.append(oh)
                # 让球「绝对值变大」= 让得更深 = 升盘；变小 = 退盘（符号本身只表示谁让）
                if abs(lh) > abs(oh):
                    up += 1
                elif abs(lh) < abs(oh):
                    dn += 1
                else:
                    flat += 1
            if lives:
                ao = sorted(abs(x) for x in opens)
                al = sorted(abs(x) for x in lives)
                print("  多公司 %d 家：退%d / 升%d / 平%d | 绝对值中位 %.2f -> %.2f" % (
                    len(lives), dn, up, flat, ao[len(ao) // 2], al[len(al) // 2]))
        else:
            problems.append("%s 缺 line" % mid)

        t = m.get("team") or {}
        for side in ("home", "away"):
            o = (t.get("overall") or {}).get(side) or {}
            print("  %s %s：%d场 %d-%d-%d 进%d失%d 排名%s" % (
                "主" if side == "home" else "客", m[side], o.get("p", 0), o.get("w", 0), o.get("d", 0),
                o.get("l", 0), o.get("gf", 0), o.get("ga", 0), o.get("rank")))
        comp = (p.get("teamComponents") or {})
        if comp:
            print("  比率链 lgHome=%.3f lgAway=%.3f attH=%.3f defH=%.3f attA=%.3f defA=%.3f" % (
                comp.get("lgHome", 0), comp.get("lgAway", 0), comp.get("attH", 0),
                comp.get("defH", 0), comp.get("attA", 0), comp.get("defA", 0)))

        print("  ana λ %.3f:%.3f（总 %.3f） HDA %.1f/%.1f/%.1f | 大2.5 %.1f%% BTTS %.1f%%" % (
            p["lamH"], p["lamA"], p["lambdaTotal"],
            p["probs"]["H"] * 100, p["probs"]["D"] * 100, p["probs"]["A"] * 100,
            p["probs"]["o25"] * 100, p["probs"]["btts"] * 100))
        sc = p.get("scores") or []
        if sc:
            print("  比分 %s" % ", ".join("%d-%d %.2f%%" % (s["h"], s["a"], s["p"] * 100) for s in sc[:3]))

        ev = next((x for x in Eitems if x.get("home") == m["home"] and x.get("away") == m["away"]), None)
        if ev and ev.get("engine"):
            e = ev["engine"]
            print("  engine xG %.2f:%.2f  HDA %.2f/%.2f/%.2f  hc_model %s" % (
                e.get("xg_h", 0), e.get("xg_a", 0),
                e.get("H", 0) * 100, e.get("D", 0) * 100, e.get("A", 0) * 100, e.get("hc_model")))
            inp = ev.get("input") or {}
            print("  engine 输入 attack 主%s / 客%s，defense 主%s / 客%s" % (
                inp.get("home_attack"), inp.get("away_attack"),
                inp.get("home_defense"), inp.get("away_defense")))
        elif E:
            sk = {s.get("no"): s.get("reason") for s in (E.get("skipped") or [])}
            if m.get("no") in sk:
                print("  engine 主动跳过：%s" % sk[m.get("no")])
            else:
                problems.append("%s 在 engine 文件里找不到同名对阵（可能读了别的批次）" % mid)
        else:
            problems.append("engine 文件缺失：双轨结论不可写")
        print("")

    if problems:
        print("!! 核对问题 %d 条：" % len(problems))
        for x in problems:
            print("   - " + x)
    else:
        print("== 清单完整，可逐项回填报告 ==")


if __name__ == "__main__":
    main(sys.argv[1:])
