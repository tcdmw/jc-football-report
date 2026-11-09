#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""fetch_batch.py — 可复用浏览器采集（全自动）。

给定一份比赛清单（格式同 meta：{matches:[{id,lg,kickoff,home,away}]}），自动：
  1. 逐场导航分析页，取 document.body.innerText 直接写 {id}.txt（无需 Blob 下载/移动）
  2. 访问 AsianOdds_n / OverDown_n，提取澳门结构化初盘与即时盘，写 {id}.handicap.json
  3. 亚盘页提取全部公司初盘/即时让球，写 {id}.line.json（退盘/升盘统计）
  4. 访问 1x2 百家欧赔页，提取初盘/即时平均胜平负赔率与归一化概率，写 {id}.1x2.json
  5. 汇总写 _fetch_report.json

用法（在 computer_use 环境，seed_browser_use 可用）：
  python tools/fetch_batch.py <清单.json> <输出目录，如 data/raw14>
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import seed_browser_use as bu

# 用码点构造“澳门”，源码不含中文字符，避免源码编码偶发误读导致乱码
MACAU = chr(0x6fb3) + chr(0x95e8)

EXTRACT_JS = r"""
let row=null;
document.querySelectorAll('tr').forEach(tr=>{
  const tds=tr.querySelectorAll('td');
  for(const td of tds){ if(td.innerText.trim().startsWith('澳')){ row=tr; break; } }
});
if(!row) return JSON.stringify({err:'no row'});
const goalEls=[...row.querySelectorAll('td[goals]')];
const openGoal=goalEls[0];
const liveGoal=row.querySelector('td[goals][oddstype="wholeLastOdds"]');
function t(g){
  return {left:g.previousElementSibling.innerText.trim(), goals:g.getAttribute('goals'),
          line:g.innerText.trim(), right:g.nextElementSibling.innerText.trim()};
}
return JSON.stringify({open:t(openGoal), live:t(liveGoal)});
"""

# 提取全部公司的亚盘初盘/即时让球（用于退盘/升盘方向统计）。
# 数值一律读 td[goals] 的 goals 属性，不读“受让半球”等文字。
EXTRACT_LINES_JS = r"""
const rows=[];
document.querySelectorAll('tr').forEach(tr=>{
  const goals=[...tr.querySelectorAll('td[goals]')];
  const tds=[...tr.querySelectorAll('td')];
  if(goals.length<2||tds.length<9) return;
  let nm=(tds[1]?.innerText||'').replace(/[*\\s]/g,'');
  if(!nm||nm.indexOf('详')>=0||nm.length>10) return;
  if(/^[0-9.]+$/.test(nm)&&nm.includes('.')) return;
  const cell=el=>el.innerText.trim();
  const liveGoal=tr.querySelector('td[goals][oddstype="wholeLastOdds"]')||goals[1];
  rows.push({name:nm,
    openHc:parseFloat(goals[0].getAttribute('goals')),
    liveHc:parseFloat(liveGoal.getAttribute('goals')),
    openHw:cell(goals[0].previousElementSibling),
    liveHw:cell(liveGoal.previousElementSibling)});
});
return JSON.stringify(rows);
"""

# 提取百家欧赔（胜平负）初盘/即时平均行：主胜 h、和 d、客胜 a 赔率，
# 以及归一化概率 ph/pd/pa（页面已去返还率，三项合计≈100%）。
EXTRACT_1X2_JS = r"""
const tables=document.querySelectorAll('table');
let target=null;
for(const t of tables){ if(t.innerText.indexOf('主胜')>=0 && t.querySelectorAll('tr').length>5){target=t;break;} }
if(!target) return JSON.stringify({err:'no table'});
const out={};
target.querySelectorAll('tr').forEach(tr=>{
  const c=[...tr.querySelectorAll('td')].map(td=>td.innerText.trim());
  if(c.length<7) return;
  const num=x=>parseFloat(x);
  if(c[0].indexOf('初盘平均值')>=0) out.openAvg={h:num(c[1]),d:num(c[2]),a:num(c[3]),ph:num(c[4]),pd:num(c[5]),pa:num(c[6])};
  if(c[0].indexOf('即时平均值')>=0) out.liveAvg={h:num(c[1]),d:num(c[2]),a:num(c[3]),ph:num(c[4]),pd:num(c[5]),pa:num(c[6])};
});
return JSON.stringify(out);
"""


def nav_wait(url: str):
    bu.navigate(url)
    bu.wait_for_load(timeout=20)
    time.sleep(1.5)

def extract() -> dict:
    return json.loads(bu.js(EXTRACT_JS))


def num(s):
    return float(s)


def main():
    manifest_path = Path(sys.argv[1])
    out_dir = Path(sys.argv[2])
    out_dir.mkdir(parents=True, exist_ok=True)

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    matches = manifest["matches"]
    report = []

    for m in matches:
        mid = m["id"]
        rec = {"id": mid, "home": m.get("home"), "away": m.get("away")}

        # 1) 分析页 txt
        nav_wait(f"https://zq.titan007.com/analysis/{mid}cn.htm")
        text = bu.js("return document.body.innerText;")
        (out_dir / f"{mid}.txt").write_text(text, encoding="utf-8")
        rec["txt_chars"] = len(text)

        # 2) 亚盘
        nav_wait(f"https://vip.titan007.com/AsianOdds_n.aspx?id={mid}&l=0")
        asian = extract()
        try:
            lines = json.loads(bu.js(EXTRACT_LINES_JS))
        except Exception:
            lines = []

        # 3) 大小球
        nav_wait(f"https://vip.titan007.com/OverDown_n.aspx?id={mid}&l=0")
        ou = extract()

        if "err" in asian or "err" in ou:
            rec["status"] = "ERROR: " + json.dumps({"asian": asian, "ou": ou}, ensure_ascii=False)
            report.append(rec)
            print(mid, "✗ 盘口提取失败", asian, ou)
            continue

        hc = num(asian["live"]["goals"])
        handicap = {
            "hc": hc,
            "live": {
                "aw": asian["live"]["right"], "hc": hc, "hw": asian["live"]["left"],
                "ouLine": ou["live"]["line"], "over": ou["live"]["left"],
                "raw": MACAU, "under": ou["live"]["right"],
            },
            "open": {
                "aw": asian["open"]["right"], "hc": num(asian["open"]["goals"]),
                "hw": asian["open"]["left"], "ouLine": ou["open"]["line"],
                "over": ou["open"]["left"], "raw": MACAU, "under": ou["open"]["right"],
            },
            "ou": ou["live"]["line"],
            "ouOver": ou["live"]["left"],
            "ouUnder": ou["live"]["right"],
            "raw": MACAU,
            "source": MACAU,
        }
        (out_dir / f"{mid}.handicap.json").write_text(
            json.dumps(handicap, ensure_ascii=False, indent=1), encoding="utf-8")

        # 多家亚盘变化（退盘/升盘），供 check_line 统计
        line_data = {"id": mid, "lines": lines}
        (out_dir / f"{mid}.line.json").write_text(
            json.dumps(line_data, ensure_ascii=False, indent=1), encoding="utf-8")

        # 4) 百家欧赔（胜平负）平均水位，供 0.25 盘下盘/平局统计；失败不阻断主流程
        try:
            nav_wait(f"https://1x2.titan007.com/oddslist/{mid}.htm")
            x12 = json.loads(bu.js(EXTRACT_1X2_JS))
            if "err" not in x12 and ("openAvg" in x12 or "liveAvg" in x12):
                (out_dir / f"{mid}.1x2.json").write_text(
                    json.dumps(x12, ensure_ascii=False, indent=1), encoding="utf-8")
                rec["x12"] = "OK"
            else:
                rec["x12"] = "MISS"
        except Exception as e:  # 欧赔为增强项，异常不影响亚盘/大小球主数据
            rec["x12"] = "ERR:" + str(e)[:40]

        rec["status"] = "OK"
        rec["hc"] = hc
        rec["ou"] = ou["live"]["line"]
        rec["lineN"] = len(lines)
        report.append(rec)
        print(mid, "✓ hc=", hc, "ou=", ou["live"]["line"], "lines=", len(lines),
              "1x2=", rec.get("x12"))

    (out_dir / "_fetch_report.json").write_text(
        json.dumps({"n": len(matches), "report": report}, ensure_ascii=False, indent=1),
        encoding="utf-8")
    ok = sum(1 for r in report if r["status"] == "OK")
    print(f"[fetch] 完成 {ok}/{len(matches)} 场，输出目录 {out_dir}")


if __name__ == "__main__":
    main()
