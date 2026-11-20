# -*- coding: utf-8 -*-
"""collect_plans_history.py — 按批次回抓球探方案的赛后推荐选项

用法（须在 computer_use_tool(plane="bu") 内 subprocess 调起）：
    python tools/collect_plans_history.py 45 46 47 48
    （参数是批次号，对应 data/out/matchesN.json）

每批读 matchesN.json 的 id/home/away，构造临时 meta，调用 fetch_post_plans.run，
输出 data/test/hist_plansN.json。
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_post_plans as FP

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main(batches):
    force = "--force" in batches
    batches = [b for b in batches if not b.startswith("--")]
    for n in batches:
        mp = os.path.join(BASE, "data", "out", f"matches{n}.json")
        out = os.path.join(BASE, "data", "test", f"hist_plans{n}.json")
        if os.path.exists(out) and not force:
            print(f"[skip] batch {n} 已有 {os.path.basename(out)}")
            continue
        if not os.path.exists(mp):
            print(f"[skip] batch {n} 缺 matches{n}.json")
            continue
        d = json.load(open(mp, encoding="utf-8"))
        ms = d.get("matches") or []
        meta = {"matches": [{"no": x.get("no"), "id": str(x["id"]), "home": x["home"],
                             "away": x["away"], "kickoff": x.get("kickoff", "")} for x in ms]}
        tmp = os.path.join(BASE, "data", "test", f"_tmp_meta{n}.json")
        json.dump(meta, open(tmp, "w", encoding="utf-8"), ensure_ascii=False)
        out = os.path.join(BASE, "data", "test", f"hist_plans{n}.json")
        print(f"\n[batch {n}] {len(ms)} 场 -> {os.path.basename(out)}")
        try:
            FP.run(tmp, out, 8)
        except Exception as e:
            print(f"[batch {n}] 失败: {e}")


if __name__ == "__main__":
    main(sys.argv[1:] or ["45", "46", "47", "48"])
