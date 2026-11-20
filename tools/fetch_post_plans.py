#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
fetch_post_plans.py — 赛后外部方案采集（球探 titan007）

与 fetch_plans.py（赛前扫首页在售）互补：本脚本按**比赛 ID** 找该场全部分析师方案，
并抽取赛后公开的「推荐选项」，用于复盘对照。

用法（必须在 computer_use_tool(plane="bu") 内用 subprocess 调起，以继承浏览器连接）：
    python tools/fetch_post_plans.py <meta.json> <out.json> [--max 15]
    python tools/fetch_post_plans.py data/test/meta_1119_0145_ou2.json data/test/post_plans57.json

输出：
    {"collectedAt":"...","items":[
      {"no":1,"id":"3092384","home":"赫根 (女)","away":"曼城 (女)",
       "page":"https://ba2.titan007.com/linkmatch/1/3092384.html",
       "total":14,
       "plans":[{"analyst":"...","record":"近19中14","title":"...","play":"让球",
                 "price":58,"bet":"皇家马德里女足 胜2球及以上","url":"..."}]}
    ]}

实测结论（2026-11-19 验证）：
- 列表页 `https://ba2.titan007.com/linkmatch/1/<matchId>.html` 覆盖该场全部方案（赛前赛后可访问）。
- 方案页的**推荐选项与「推」标记赛后公开可读**，只有详细分析正文（约 40 球币起）仍锁。
- 因此可统计外部方案在让球/总进球上的命中，作为复盘的独立第四方参照。
"""
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import seed_browser_use as bu  # noqa: E402

LIST_URL = "https://ba2.titan007.com/linkmatch/1/{mid}.html"

LIST_JS = r'''
var out = [];
var all = document.querySelectorAll('a');
for (var i = 0; i < all.length; i++) {
  var h = all[i].getAttribute('href') || '';
  var m = h.match(/ba2\.titan007\.com\/(\d+)\/(\d+)\.html/);
  if (!m) continue;
  var url = h.indexOf('http') === 0 ? h : ('https://ba2.titan007.com/' + m[1] + '/' + m[2] + '.html');
  out.push({ url: url, title: (all[i].innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80) });
}
return JSON.stringify(out);
'''

PLAYS = ("让球", "总进球", "亚让", "大小球")


def safe_lines():
    return [l.strip() for l in str(bu.get_page_text()).split("\n") if l.strip()]


def parse_plan(lines):
    """从方案页行序列抽取：玩法、价格、查看人数、推荐选项（「推」前一行）"""
    play = None
    price = None
    bet = None
    for i, l in enumerate(lines):
        if play is None and l in PLAYS:
            play = l
        m = re.search(r"(\d+)\s*球币", l)
        if m and price is None:
            price = int(m.group(1))
        if l == "推" and i > 0 and bet is None:
            prev = lines[i - 1]
            # 推荐选项可能是"<队名> 胜2球及以上"或"4球及以上"
            bet = prev
            if i > 1:
                cand = lines[i - 2]
                if (cand and len(cand) <= 14
                        and not re.search(r"球及|胜|负|不败|推荐|分析|完场|杯|联赛", cand)):
                    bet = cand + " " + prev
    return play, price, bet


def run(meta_path, out_path, max_plans=15):
    meta = json.load(open(meta_path, encoding="utf-8"))
    items = []
    for mm in meta["matches"]:
        mid = str(mm["id"])
        page = LIST_URL.format(mid=mid)
        bu.navigate(page)
        bu.wait_for_load(timeout=25)
        time.sleep(2)
        rows = bu.read_all("a", fields=["href", "text"], limit=200)
        raw = []
        for r in rows:
            h = str(r.get("href", "") or "")
            mt = re.search(r"ba2\.titan007\.com/(\d+)/(\d+)\.html", h)
            if not mt:
                continue
            url = h if h.startswith("http") else f"https://ba2.titan007.com/{mt.group(1)}/{mt.group(2)}.html"
            raw.append({"url": url, "title": str(r.get("text", "") or "").strip()[:80]})
        seen = set()
        plans = []
        for a in raw:
            u = a["url"]
            if u in seen:
                continue
            seen.add(u)
            if len(plans) >= max_plans:
                break
            plans.append({"title": a["title"], "url": u})
        # 补详情
        for p in plans:
            time.sleep(2)
            bu.navigate(p["url"])
            bu.wait_for_load(timeout=20)
            lines = safe_lines()
            analyst = lines[22].strip() if len(lines) > 22 else ""
            record = ""
            for l in lines[:32]:
                if re.match(r"近\s*\d+\s*中\s*\d+", l):
                    record = l
                    break
            play, price, bet = parse_plan(lines)
            p.update({"analyst": analyst, "record": record, "play": play, "price": price, "bet": bet})
        items.append({
            "no": mm.get("no"), "id": mid, "home": mm.get("home"), "away": mm.get("away"),
            "page": page, "total": len(plans), "plans": plans,
        })
        print(f"[post_plans] {mid} {mm.get('home')} vs {mm.get('away')} 方案 {len(plans)} 条")
        for p in plans:
            print(f"   {p.get('play') or '?':4} {p.get('bet') or '(未读到推荐)':22} | {p.get('analyst','')[:14]} {p.get('record','')}")
    doc = {"collectedAt": time.strftime("%Y-%m-%dT%H:%M:%S"), "source": "titan007_post", "items": items}
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    json.dump(doc, open(out_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"[post_plans] 写出 {out_path}")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(2)
    mp, op = sys.argv[1], sys.argv[2]
    mx = 15
    if "--max" in sys.argv:
        mx = int(sys.argv[sys.argv.index("--max") + 1])
    run(mp, op, mx)
