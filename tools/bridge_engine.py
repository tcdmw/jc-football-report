#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""bridge_engine.py — 把 v4 collect 的独立输入注入 football-engine 的 TeamRating，跑第二轨。

关键点（来自经验 football-engine-teamrating-injection）：
  1. 不能留 TeamRating 默认值 1.0/0.0 —— 那会让 xG 恒等于模板值（独立模型静默空转）。
  2. attack ≈ 场均进球 / base_goals，defense ≈ 场均失球 / base_goals（defense<1 表示防守好）。
  3. 主队用「主队·主场」样本，客队用「客队·客场」样本，不可混用。
  4. handicap 符号：模型内 adjusted_diff = (i-j) + handicap，主让为负；本项目 hc 主让为正，需取负。
验证信号是逐场 xG 不同，而不是退出码。

用法: python tools/bridge_engine.py data/out/matches.json data/out/engine_preds.json
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

JACK_ROOT = Path(__file__).resolve().parent.parent      # jc-football-report-main
PROJ_ROOT = JACK_ROOT.parent                            # new-chat
ENGINE_ROOT = PROJ_ROOT / "football-engine-main"
sys.path.insert(0, str(ENGINE_ROOT))

from engine.prediction.base import TeamRating                                   # noqa: E402
from engine.prediction.dixon_coles import DixonColesConfig, DixonColesModel    # noqa: E402


def clamp(x, lo, hi):
    return max(lo, min(hi, x))


def load_cfg():
    cfg_path = ENGINE_ROOT / "config" / "prediction.json"
    base = dict(base_goals=1.35, attack_weight=1.0, defense_weight=0.9,
                form_weight=0.65, market_blend_weight=0.0, rho=-0.08, max_goals=10)
    try:
        raw = json.loads(cfg_path.read_text(encoding="utf-8"))
        pred = raw.get("prediction", {})
        for k in base:
            if k in pred:
                base[k] = pred[k]
    except Exception as e:                                   # 配置缺失不应阻断，但要留下痕迹
        base["_cfg_error"] = str(e)
    return DixonColesConfig(**base)


def split_row(row):
    """返回 (p, gf, ga)；样本不足或缺失时返回 None。"""
    if not row or not row.get("p"):
        return None
    return int(row["p"]), float(row.get("gf", 0)), float(row.get("ga", 0))


def build_rating(name, split, form_row, base_goals, rest_days=None):
    """split: 该队在本场的场地样本(主队取主场/客队取客场)；form_row: 近 6 场；rest_days: 赛程间隔。"""
    notes = []
    if split:
        p, gf, ga = split
        attack = (gf / p) / base_goals
        defense = (ga / p) / base_goals
        notes.append(f"{'主' if True else ''}样本 {p} 场 {gf:.0f} 得 {ga:.0f} 失")
    else:
        attack = defense = 1.0
        notes.append("场地样本缺失，退回 1.0（本场独立输入不完整）")

    form = 0.0
    if form_row:
        fp, fgf, fga = form_row
        form = clamp((fgf - fga) / fp / base_goals, -0.8, 0.8)

    attack = clamp(attack, 0.70, 1.45)
    defense = clamp(defense, 0.70, 1.45)
    # rest_days 是 engine 已生效字段（dixon_coles 用 min(rest,7)*rest_weight）。
    # 缺数据时不传，保留 TeamRating 默认 3，不臆造。
    kw = {}
    if rest_days is not None:
        kw["rest_days"] = int(rest_days)
        notes.append(f"赛程间隔 {rest_days} 天")
    return TeamRating(name=name, attack=attack, defense=defense, form=form, **kw), notes


def main():
    matches_path = Path(sys.argv[1] if len(sys.argv) > 1 else "data/out/matches.json")
    out_path = Path(sys.argv[2] if len(sys.argv) > 2 else "data/out/engine_preds.json")
    matches = json.loads(matches_path.read_text(encoding="utf-8"))["matches"]

    cfg = load_cfg()
    model = DixonColesModel(cfg)

    rows, skipped = [], []
    for m in matches:
        team = m.get("team") or {}
        home_split = split_row(((team.get("home") or {}).get("home")) or {})
        away_split = split_row(((team.get("away") or {}).get("away")) or {})
        form = team.get("form") or {}
        if not home_split or not away_split:
            skipped.append({"no": m["no"], "reason": "主客场地样本缺失，拒绝用默认强度硬跑"})
            continue
        # 低样本拒跑（与 analyze 硬校验同口径：任一 P<3 不做单场外推）
        hp, ap = home_split[0], away_split[0]
        if hp < 3 or ap < 3:
            skipped.append({"no": m["no"], "reason": f"样本不足（主队主场 P={hp}，客队客场 P={ap}，任一 <3），拒跑防单场静默外推"})
            continue

        rest = m.get("restDays") or {}
        hr, hnotes = build_rating(m["home"], home_split, split_row(form.get("home") or {}),
                                  cfg.base_goals, rest_days=rest.get("home"))
        ar, anotes = build_rating(m["away"], away_split, split_row(form.get("away") or {}),
                                  cfg.base_goals, rest_days=rest.get("away"))

        hc = m.get("hc")
        handicap = None if hc is None else -float(hc)        # 主让为正 → 模型口径取负
        spf = m.get("spf")
        market_odds = None
        if spf:
            market_odds = (float(spf[0]), float(spf[1]), float(spf[2]))

        pred = model.predict(hr, ar, market_odds=market_odds, handicap=handicap)

        rows.append({
            "no": m["no"], "home": m["home"], "away": m["away"],
            "engine": {
                "xg_h": pred.home_xg, "xg_a": pred.away_xg,
                "H": pred.home_win_prob, "D": pred.draw_prob, "A": pred.away_win_prob,
                "rq": [pred.handicap_home_prob, pred.handicap_draw_prob, pred.handicap_away_prob],
                "hc_model": handicap,
            },
            "input": {
                "home_attack": round(hr.attack, 4), "home_defense": round(hr.defense, 4), "home_form": round(hr.form, 4),
                "home_rest": hr.rest_days,
                "away_attack": round(ar.attack, 4), "away_defense": round(ar.defense, 4), "away_form": round(ar.form, 4),
                "away_rest": ar.rest_days,
                "notes": hnotes + anotes,
            },
        })

    payload = {"model": "dixon_coles", "config": {k: getattr(cfg, k) for k in
               ("base_goals", "attack_weight", "defense_weight", "form_weight", "market_blend_weight", "rho")},
               "n": len(rows), "skipped": skipped, "preds": rows}
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"[engine] 成功 {len(rows)} 场 | 跳过 {len(skipped)} 场 | 输出 {out_path}")
    print("no 主队             xG(主:客)        H-D-A%        让球(主/走/客)")
    for r in rows:
        e = r["engine"]
        print(f"{r['no']:>2} {r['home']:<14} {e['xg_h']:.2f}:{e['xg_a']:.2f}   "
              f"{e['H']*100:>5.1f}/{e['D']*100:>5.1f}/{e['A']*100:>5.1f}   "
              f"{e['rq'][0]*100:>5.1f}/{e['rq'][1]*100:>5.1f}/{e['rq'][2]*100:>5.1f}")
    # 空转检测：所有 xG 相同即为静默失败
    pairs = {(r["engine"]["xg_h"], r["engine"]["xg_a"]) for r in rows}
    if len(rows) > 1 and len(pairs) == 1:
        print("[engine] ✗ xG 全部相同 —— 独立输入未生效（静默空转）")
        sys.exit(3)
    for s in skipped:
        print(f"  ! 跳过 {s['no']}: {s['reason']}")


if __name__ == "__main__":
    main()
