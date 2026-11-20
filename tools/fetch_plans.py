#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
fetch_plans.py — 外部方案资料采集（球探 titan007 分析师方案 + 懂球帝预测）

用法（必须在 computer_use_tool(plane="bu") 内用 subprocess 调起，以继承浏览器连接）：
    python tools/fetch_plans.py <meta.json> <raw_dir>
    python tools/fetch_plans.py data/test/meta_1117_0345_5.json data/raw50

输出：<raw_dir>/_plans.json
    {
      "source": "titan007_analyst",
      "collectedAt": "...",
      "items": [
        {"id":"2981469","home":"德国","away":"荷兰",
         "plans":[{"analyst":"...","record":"近8中7","title":"...","url":"...",
                   "play":"让球","hasPaidBody":true,"viewers":58,"pubText":"..."}]}
      ]
    }

边界（实测，勿绕过）：
- 球探方案页公开段可读：分析师名+战绩标签、玩法、比赛信息、分析铺垫段、对赛往绩表、
  "本场赛事其它推荐"（同场其他方案与查看人数）。
- 真正推荐结论约 170-190 字被付费墙挡住（"推荐内容已隐藏"），不绕过。
- 首页仅覆盖"当前在售/未开赛"赛事；赛后无法回溯，故必须在赛前调用。
"""
import json
import re
import sys
import time
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import seed_browser_use as bu  # noqa: E402

HOME = "https://www.titan007.com/"

EXTRACT_CARDS = r'''
(() => {
  const out = [];
  document.querySelectorAll('a[href*="ba2.titan007.com"]').forEach(a => {
    const h = a.getAttribute('href');
    if (!/ba2\.titan007\.com\/\d+\/\d+\.html/.test(h)) return;
    // 只取"单张卡片"：从 a 向上逐层，选第一个文字 30-260 且只含一个 VS 的祖先
    let node = a, ctx = "", guard = 0;
    while (node.parentElement && guard++ < 6) {
      node = node.parentElement;
      const t = (node.innerText || '').replace(/\s+/g, ' ').trim();
      const vs = (t.match(/VS/gi) || []).length;
      if (t.length >= 30 && t.length <= 260 && vs === 1) { ctx = t; break; }
      if (t.length > 260) break;
      ctx = t;
    }
    out.push({ href: h, title: (a.innerText || '').replace(/\s+/g, ' ').trim(), ctx: ctx.slice(0, 200) });
  });
  return JSON.stringify(out);
})()
'''

# 标题里常见的对阵形态： "21:00 非洲杯 莱索托 VS 加蓬" / "22.00《国际友谊》卡塔尔VS韩国"
PAIR = re.compile(r"(\d{1,2}[:.．]\d{2})\s*[《]?\s*([^《》\s]{0,10})\s*[》]?\s*([^\sVS]{1,14})\s*VS\s*([^\s]{1,14})", re.I)


def norm(s):
    return re.sub(r"[\s()（）·\-—*]", "", s or "")


def match_pair(ctx, home, away):
    """ctx 里是否同时出现两队名（别名容错交给调用方）"""
    c = norm(ctx)
    return norm(home) in c and norm(away) in c


def main():
    meta_path, raw_dir = sys.argv[1], sys.argv[2]
    deep = "--deep" in sys.argv
    meta = json.load(open(meta_path, encoding="utf-8"))

    bu.navigate(HOME)
    bu.wait_for_load(timeout=25)
    time.sleep(2)
    for _ in range(3):
        bu.js("window.scrollBy(0, 800)")
        time.sleep(1)
    cards = json.loads(bu.js(EXTRACT_CARDS))

    seen = set()
    uniq = []
    for c in cards:
        if c["href"] in seen:
            continue
        seen.add(c["href"])
        uniq.append(c)

    items = []
    for m in meta["matches"]:
        hits = [c for c in uniq if match_pair(c["ctx"], m["home"], m["away"])
                or match_pair(c["title"], m["home"], m["away"])]
        plans = []
        for c in hits:
            mm = PAIR.search(c["ctx"]) or PAIR.search(c["title"])
            url = "https:" + c["href"] if c["href"].startswith("//") else c["href"]
            plan = {
                "analyst": None,
                "record": None,
                "title": c["title"][:60],
                "url": url,
                "kickoff": mm.group(1) if mm else None,
                "league": mm.group(2) if mm else None,
                "play": role_of(c["ctx"]),
                "hasPaidBody": True,
            }
            if deep:
                try:
                    bu.navigate(url)
                    bu.wait_for_load(timeout=18)
                    time.sleep(1)
                    plan.update(parse_detail(bu.js(DEEP_EXTRACT), url))
                except Exception as e:
                    plan["deepError"] = str(e)[:60]
                time.sleep(0.4)
            plans.append(plan)
        items.append({"id": m["id"], "home": m["home"], "away": m["away"], "plans": plans})

    out = {
        "source": "titan007_analyst",
        "homePagePlansTotal": len(uniq),
        "collectedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
        "items": items,
    }
    os.makedirs(raw_dir, exist_ok=True)
    path = os.path.join(raw_dir, "_plans.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)

    n_hit = sum(1 for x in items if x["plans"])
    print(f"[fetch_plans] 首页方案 {len(uniq)} 条；{len(items)} 场中 {n_hit} 场匹配到方案 -> {path}")
    for x in items:
        if x["plans"]:
            print(f"  {x['id']} {x['home']}vs{x['away']}: {len(x['plans'])} 条")


DEEP_EXTRACT = r'''
(() => {
  const t = (document.body.innerText || '').replace(/\r/g, '');
  return t;
})()
'''


def parse_detail(text, url):
    """从方案详情页正文提取：分析师名、战绩标签、玩法、公开分析段、是否付费隐藏"""
    lines = [x.strip() for x in text.split("\n") if x.strip()]
    d = {"analyst": None, "record": None, "play": None, "pubText": None, "hasPaidBody": False}
    # 分析师名："关注"之前一行；若该行是战绩标签，则名字再往前一行
    REC = re.compile(r"^(近\d+中\d+|近\d+红|\d+连红|回报\d+|[\d.]+%|.{0,6}\d+中\d+)")
    for i, ln in enumerate(lines):
        if ln in ("+关注", "关注") and i > 0:
            cand = lines[i - 1][:16]
            if REC.match(cand):
                d["record"] = cand
                d["analyst"] = lines[i - 2][:16] if i > 1 else None
            else:
                d["analyst"] = cand
                for j in range(i, min(i + 4, len(lines))):
                    if REC.match(lines[j]):
                        d["record"] = lines[j][:24]
                        break
            break
    # 玩法：在正文前段找 让球 / 大小球 / 让分 的首次出现（页面可能是 tab 或 "让球 主0.5"）
    head = "\n".join(lines[:60])
    for kw, val in (("大小球", "大小球"), ("让球", "让球"), ("让分", "让分"), ("胜平负", "胜平负")):
        if kw in head:
            d["play"] = val
            break
    # 公开分析段
    m = re.search(r"推荐分析\s*\n?(.{20,}?)(?:推荐内容|隐藏内容|对赛往绩)", text, re.S)
    if m:
        d["pubText"] = re.sub(r"\s+", " ", m.group(1))[:400]
    d["hasPaidBody"] = ("已隐藏" in text) or ("付费后可以看见" in text)
    idm = re.search(r"ba2\.titan007\.com/(\d+)/(\d+)\.html", url)
    if idm:
        d["analystId"], d["articleId"] = idm.group(1), idm.group(2)
    return d


def role_of(ctx):
    if "大小" in ctx or "进球" in ctx:
        return "大小球"
    if "让球" in ctx or "让分" in ctx:
        return "让球"
    return "未标注"


if __name__ == "__main__":
    main()
