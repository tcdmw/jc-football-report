#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""bridge_lottery.py — 把 v4 collect 的盘口送入 football_lottery_prediction，跑第一轨。

上轮的 null 根因：data_sources 被拆成 local_500_series_euro / local_500_series_asian 两个键，
维护方法按「source_name -> {european_odds, asian_handicap, over_under}」单层遍历，
拆键后每层拿不到对应字段。本版强制单一键。

用法: python tools/bridge_lottery.py data/out/matches.json data/out/lottery_preds.json
"""
from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path

JC_ROOT = Path(__file__).resolve().parent.parent
PROJ_ROOT = JC_ROOT.parent
LOT_ROOT = PROJ_ROOT / "football_lottery_prediction-main"
sys.path.insert(0, str(LOT_ROOT))

from integrated_prediction_system import IntegratedPredictionSystem   # noqa: E402

HC_TEXT = {-2.0: "受让两球", -1.5: "受让球半", -1.25: "受让一球/球半", -1.0: "受让一球",
           -0.75: "受让半球/一球", -0.5: "受让半球", -0.25: "受让平手/半球", 0.0: "平手",
           0.25: "平手/半球", 0.5: "半球", 0.75: "半球/一球", 1.0: "一球",
           1.25: "一球/球半", 1.5: "球半", 2.0: "两球", 2.25: "两球/两球半"}


def build_source(m):
    """单一数据源：竞彩官方 = 欧赔；球探初盘 = 亚盘。"""
    src = {
        "match_info": {"match_id": m.get("id"), "home": m["home"], "away": m["away"], "kickoff": m.get("kickoff")},
        "european_odds": [],
        "asian_handicap": [],
        "over_under": [],
    }
    spf = m.get("spf")
    if spf:
        src["european_odds"].append({
            "company": "竞彩官方",
            "current_odds": [float(spf[0]), float(spf[1]), float(spf[2])],
            "is_official": True,
        })
    hc = m.get("hc")
    if hc is not None:
        # 该项目 _validate_asian_handicap_value 只接受数字/平手，中文盘口名会被拒（已实测）
        hc_num = f"{float(hc):g}"
        src["asian_handicap"].append({
            "company": "titan007-初盘",
            "current_odds": [1.90, hc_num, 1.90],       # 水位页面未给，1.90 为中性占位
            "handicap": hc_num,
            "handicap_text": HC_TEXT.get(float(hc), hc_num),
            "is_official": False,
        })
    return src


def main():
    matches_path = Path(sys.argv[1] if len(sys.argv) > 1 else "data/out/matches.json")
    out_path = Path(sys.argv[2] if len(sys.argv) > 2 else "data/out/lottery_preds.json")
    matches = json.loads(matches_path.read_text(encoding="utf-8"))["matches"]

    system = IntegratedPredictionSystem()
    rows, failed = [], []

    for m in matches:
        # 单层键：一家数据源承载欧赔/亚盘/大小球三类字段
        multi_source_data = {
            "data_sources": {"local_titan007_jc": build_source(m)},
            "collection_errors": [],
            "collection_time": datetime.now().isoformat(),
            "sources_count": 1,
        }
        try:
            manip = system.detect_market_manipulation(multi_source_data)
            market = system.perform_comprehensive_market_analysis(multi_source_data, manip)
            preds = system.generate_multi_dimensional_predictions(multi_source_data, market, manip)
        except Exception as e:                                  # 单场失败不应静默丢弃
            failed.append({"no": m["no"], "error": f"{type(e).__name__}: {e}"})
            continue

        euro = (market or {}).get("european_analysis") or {}
        asian = (market or {}).get("asian_analysis") or {}
        ou = (market or {}).get("over_under_analysis") or {}
        rows.append({
            "no": m["no"], "home": m["home"], "away": m["away"],
            "lottery": {
                "risk": (manip or {}).get("overall_risk"),
                "risk_level": (manip or {}).get("risk_level"),
                "euro_recommended": euro.get("recommended_outcome"),
                "euro_avg_odds": euro.get("average_odds"),
                "euro_implied": euro.get("implied_probabilities"),
                "euro_efficiency": euro.get("market_efficiency"),
                "asian_recommended": asian.get("recommended_outcome") or asian.get("recommended"),
                "asian_analysis": asian,
                "ou_recommended": ou.get("recommended_outcome"),
                "ou_main_line": ou.get("main_line"),
                "predictions": preds,
            },
        })

    payload = {"system": "IntegratedPredictionSystem", "n": len(rows), "failed": failed, "preds": rows}
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=1, default=str), encoding="utf-8")

    print(f"[lottery] 成功 {len(rows)} 场 | 失败 {len(failed)} 场 | 输出 {out_path}")
    print("no 主队             风险级别  亚盘推荐  欧赔推荐")
    asian_n = 0
    for r in rows:
        lot = r["lottery"]
        if lot["asian_recommended"]:
            asian_n += 1
        print(f"{r['no']:>2} {r['home']:<14} {str(lot['risk_level']):<8} "
              f"{str(lot['asian_recommended'])[:20]:<22} {str(lot['euro_recommended'])}")
    print(f"[lottery] 亚盘维度有输出 {asian_n}/{len(rows)} 场；欧赔维度受其校验区间限制（见 README 口径说明）")
    for f in failed:
        print(f"  ! 失败 {f['no']}: {f['error']}")
    if failed:
        sys.exit(3)


if __name__ == "__main__":
    main()
