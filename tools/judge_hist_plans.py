# -*- coding: utf-8 -*-
"""judge_hist_plans.py — 历史球探方案推荐选项的命中判定与汇总

用法：
    python tools/judge_hist_plans.py 45 46 47 48 49

输入：data/test/hist_plansN.json + data/out/matchesN.json + data/test/resultsN.json
输出：终端汇总 + data/test/plans_stat.json

bet 文本口径（球探为整数让球表述，非亚盘）：
  "X 胜N球及以上"      -> X 净胜 >= N
  "X 负N球及以下(胜/平)" -> X 净胜 >= -N
  "X 胜" / "X 不败(胜/平)" -> X 胜 / X 不败
  "N球及以上/以下"      -> 总进球 >= / <= N
"""
import json
import os
import re
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIG = re.compile(r"\d+")


def norm(s):
    return re.sub(r"[\s()（）·\-—*女足女]", "", s or "")


def team_of(bet, home, away):
    """判断 bet 指向哪一方：'H' / 'A' / None"""
    b = norm(bet)
    h, a = norm(home), norm(away)
    # 去掉"女足"后再比对，取前 4 字做前缀匹配
    for name, tag in ((h, "H"), (a, "A")):
        if not name:
            continue
        core = name[:4]
        if core and core in b:
            return tag
        if name[:2] and name[:2] in b and len(name) <= 4:
            return tag
    return None


def judge(bet, gh, ga, home, away):
    """返回 dict(result, kind, detail)"""
    b = bet or ""
    if not b:
        return None
    total = gh + ga

    # 总进球
    if "球及以上" in b or "球及以下" in b:
        nums = DIG.findall(b)
        if not nums:
            return None
        n = int(nums[0])
        # 有队名 -> 让球；无队名 -> 总进球
        side = team_of(b, home, away)
        if side is None:
            if "球及以上" in b:
                return {"kind": "总进球", "line": n, "judge": "对" if total >= n else "错"}
            return {"kind": "总进球", "line": n, "judge": "对" if total <= n else "错"}

    if "胜" in b and "球及以上" in b:
        nums = DIG.findall(b)
        n = int(nums[0]) if nums else 1
        side = team_of(b, home, away)
        if side is None:
            return None
        diff = (gh - ga) if side == "H" else (ga - gh)
        return {"kind": "让球", "side": side, "line": n, "judge": "对" if diff >= n else "错"}

    if "负" in b and "球及以下" in b:
        nums = DIG.findall(b)
        n = int(nums[0]) if nums else 1
        side = team_of(b, home, away)
        if side is None:
            return None
        diff = (gh - ga) if side == "H" else (ga - gh)
        return {"kind": "让球", "side": side, "line": n, "judge": "对" if diff >= -n else "错"}

    if "不败" in b:
        side = team_of(b, home, away)
        if side is None:
            return None
        win = (gh > ga) if side == "H" else (ga > gh)
        draw = gh == ga
        return {"kind": "让球", "side": side, "line": 0, "judge": "对" if (win or draw) else "错"}

    if b.endswith("胜") or b.strip() == "胜":
        side = team_of(b, home, away)
        if side is None:
            return None
        win = (gh > ga) if side == "H" else (ga > gh)
        return {"kind": "让球", "side": side, "line": 0, "judge": "对" if win else "错"}
    return None


def main(batches):
    all_rows = []
    for n in batches:
        hp = os.path.join(BASE, "data", "test", f"hist_plans{n}.json")
        mp = os.path.join(BASE, "data", "out", f"matches{n}.json")
        rp = os.path.join(BASE, "data", "test", f"results{n}.json")
        if not (os.path.exists(hp) and os.path.exists(rp)):
            print(f"[skip] batch {n} 缺方案或赛果")
            continue
        plans = json.load(open(hp, encoding="utf-8"))
        results = (json.load(open(rp, encoding="utf-8")) or {}).get("results") or {}
        for it in plans.get("items", []):
            no = str(it.get("no"))
            if no not in results:
                continue
            gh, ga = results[no]
            cnt = {}
            for p in it.get("plans", []):
                j = judge(p.get("bet") or "", gh, ga, it.get("home") or "", it.get("away") or "")
                if not j:
                    continue
                r = {"batch": n, "no": no, "home": it.get("home"), "away": it.get("away"),
                     "score": [gh, ga], "analyst": p.get("analyst"), "bet": p.get("bet"), **j}
                all_rows.append(r)
                cnt[j["kind"]] = cnt.get(j["kind"], 0) + 1
            print(f"  [{n}-{no}] {it.get('home')} {gh}-{ga} {it.get('away')} | 判定 {cnt}")

    # 汇总
    def rate(kind=None):
        rows = [r for r in all_rows if (kind is None or r["kind"] == kind)]
        ok = sum(1 for r in rows if r["judge"] == "对")
        return ok, len(rows)

    print("\n=== 汇总 ===")
    for k in ["让球", "总进球", None]:
        ok, tot = rate(k)
        label = k or "合计"
        pct = (ok / tot * 100) if tot else 0
        print(f"{label:6}: {ok}/{tot} = {pct:.1f}%")

    print("\n=== 总进球按线位分组 ===")
    for name, cond in (("押小(线<=2)", lambda r: r.get("line", 9) <= 2),
                       ("押大(线>=3)", lambda r: r.get("line", 0) >= 3)):
        rs = [r for r in all_rows if r["kind"] == "总进球" and cond(r)]
        ok = sum(1 for r in rs if r["judge"] == "对")
        pct = (ok / len(rs) * 100) if rs else 0
        print(f"{name}: {ok}/{len(rs)} = {pct:.1f}%")

    print("\n=== 让球明细（样本小） ===")
    for r in [x for x in all_rows if x["kind"] == "让球"]:
        print(f"  [{r['batch']}-{r['no']}] {r['home']} {r['score'][0]}-{r['score'][1]} {r['away']} | "
              f"{r['bet']} -> {r['judge']}")

    out = os.path.join(BASE, "data", "test", "plans_stat.json")
    json.dump({"batches": batches, "rows": all_rows}, open(out, "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    print(f"写出 {out}")


if __name__ == "__main__":
    main(sys.argv[1:] or ["45", "46", "47", "48", "49"])
