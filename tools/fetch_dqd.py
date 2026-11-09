#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""fetch_dqd.py — 懂球帝情报采集（伤停 + 必发真实资金），可复用、全自动。

给定一份 titan007 清单（同 meta：{matches:[{id,home,away,kickoff}]}），自动：
  1. 打开懂球帝「全球」赛程页，滚动加载，提取全部比赛（dqd match id、队名、时间）
  2. 用 tools/dqd_aliases.json 处理同队异译，按队名+时间匹配 titan007 id -> dqd id
  3. 逐场打开 lotIntelligence，提取：状态伤停、必发冷热分布、必发大注倾向
  4. 写 {titan007_id}.dqd.json；未匹配/无数据的场如实记录，不阻断其余场
  5. 汇总写 _dqd_report.json

所有数字均来自页面 DOM，本脚本不做任何手算或推算。

用法（computer_use 环境，seed_browser_use 可用）：
  python tools/fetch_dqd.py <清单.json> <输出目录，如 data/raw26>
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import seed_browser_use as bu

TOOLS_DIR = Path(__file__).resolve().parent
GLOBAL_URL = "https://m.dongqiudi.com/match/12"

# 列表页：提取所有比赛（含 dqd id、主客队、HH:MM 与联赛）
LIST_JS = r"""
(function(){
  var rows=[];
  document.querySelectorAll('li.match-calendar-item').forEach(function(li){
    var a=li.querySelector('.match-item-a p');
    var b=li.querySelector('.match-item-b p');
    var c=li.querySelector('.match-item-c p');
    if(a&&b){
      var t=c?c.innerText.replace(/\s+/g,' ').trim():'';
      rows.push({id:li.id.replace(/^id/,''),home:a.innerText.trim(),away:b.innerText.trim(),time:t});
    }
  });
  return rows;
})()
"""

# 情报页：状态伤停 + 必发冷热分布 + 必发大注倾向
EXTRACT_DQD_JS = r"""
(function(){
  var out={};
  // 1) 状态伤停
  var ih=null;
  document.querySelectorAll('h2').forEach(function(h){ if(h.innerText.trim()==='状态伤停') ih=h; });
  if(ih){
    var inj=[];
    var row=ih.parentElement.querySelector('div.row');
    if(row){
      var curTeam=null;
      row.querySelectorAll('p.team-name-tit, div.col').forEach(function(node){
        if(node.classList.contains('team-name-tit')){
          curTeam=node.innerText.trim();
        }else{
          node.querySelectorAll('li').forEach(function(li){
            var sp=li.querySelector('span');
            var tx=li.querySelector('p');
            var text=tx?tx.innerText.trim():li.innerText.trim();
            inj.push({team:curTeam, tag:sp?sp.innerText.trim():'', text:text,
                      isInjury:(text.indexOf('伤')>=0||text.indexOf('停')>=0||text.indexOf('疑')>=0)});
          });
        }
      });
    }
    out.injuries=inj;
  }
  // 2) 必发冷热分布
  var ch=document.querySelector('div.cold-hot');
  if(ch){
    var comment=ch.querySelector('p.comment');
    out.betfairComment=comment?comment.innerText.replace(/\s+/g,' ').trim():'';
    var bf=[];
    ch.querySelectorAll('table tbody tr').forEach(function(tr){
      var c=[].map.call(tr.querySelectorAll('td'),function(td){return td.innerText.trim();});
      if(c.length>=6) bf.push({option:c[0],price:c[1],volume:c[2],ratio:c[3],pnl:c[4],index:c[5]});
    });
    out.betfair=bf;
  }
  // 3) 必发大注倾向
  var lt=document.querySelector('div.lot-trend');
  if(lt){
    var lc=lt.querySelector('p.comment');
    var groups={};
    ['buy','sale'].forEach(function(g){
      var wrap=lt.querySelector('.lot-trend-wrap .'+g);
      if(wrap){
        groups[g]=[].map.call(wrap.querySelectorAll('.bar-inner'),function(b){
          return b.innerText.replace(/\s+/g,'').trim();
        });
      }
    });
    out.bigTrend={comment:lc?lc.innerText.replace(/\s+/g,' ').trim():'',
                  labels:['主胜','平局','客胜'], groups:groups};
  }
  return JSON.stringify(out);
})()
"""


def load_aliases() -> dict:
    try:
        raw = json.loads((TOOLS_DIR / "dqd_aliases.json").read_text(encoding="utf-8"))
        return raw.get("home_or_away_aliases", {})
    except Exception:
        return {}


def norm(name: str, aliases: dict) -> str:
    name = (name or "").replace(" ", "").strip()
    return aliases.get(name, name)


def hhmm(s: str) -> str:
    # 从 "02:15 挪超" 或 "2026-11-09 02:15" 取 HH:MM
    import re
    m = re.search(r"(\d{1,2}:\d{2})", s or "")
    return m.group(1) if m else ""


def nav_wait(url: str):
    bu.navigate(url)
    bu.wait_for_load(timeout=20)
    time.sleep(1.5)


def collect_global_list() -> list:
    nav_wait(GLOBAL_URL)
    prev = -1
    for _ in range(20):
        bu.js("window.scrollTo(0, document.body.scrollHeight);")
        time.sleep(1.0)
        n = bu.js("return document.querySelectorAll('li.match-calendar-item').length;")
        if n == prev:
            break
        prev = n
    return bu.js(LIST_JS)


def main():
    manifest = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    out_dir = Path(sys.argv[2])
    out_dir.mkdir(parents=True, exist_ok=True)
    aliases = load_aliases()

    dqd_rows = collect_global_list()
    # 预归一化懂球帝队名（懂球帝队名一般无需再转，但保留去空格）
    index = []
    for r in dqd_rows:
        index.append({
            "id": r["id"],
            "home": norm(r["home"], {}),
            "away": norm(r["away"], {}),
            "tm": hhmm(r["time"]),
        })

    report = []
    for m in manifest["matches"]:
        tid = m["id"]
        th = norm(m["home"], aliases)
        ta = norm(m["away"], aliases)
        tm = hhmm(m.get("kickoff", ""))
        cand = [r for r in index if r["home"] == th and r["away"] == ta]
        if tm and len(cand) > 1:
            timed = [r for r in cand if r["tm"] == tm]
            if timed:
                cand = timed
        rec = {"id": tid, "home": m["home"], "away": m["away"]}
        if not cand:
            rec["status"] = "UNMATCHED"
            report.append(rec)
            print(tid, "✗ 未在懂球帝列表匹配到", th, ta)
            continue
        dqd_id = cand[0]["id"]
        rec["dqdId"] = dqd_id

        try:
            nav_wait(f"https://m.dongqiudi.com/matchDetail/{dqd_id}/lotIntelligence")
            data = json.loads(bu.js(EXTRACT_DQD_JS))
            payload = {
                "titan007_id": tid, "dqd_id": dqd_id,
                "home": m["home"], "away": m["away"],
                "injuries": data.get("injuries", []),
                "betfairComment": data.get("betfairComment", ""),
                "betfair": data.get("betfair", []),
                "bigTrend": data.get("bigTrend", {}),
            }
            (out_dir / f"{tid}.dqd.json").write_text(
                json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
            rec["status"] = "OK"
            rec["injuryItems"] = len(payload["injuries"])
            rec["betfairRows"] = len(payload["betfair"])
            print(tid, "✓ dqd=", dqd_id, "伤停条目=", rec["injuryItems"],
                  "必发行=", rec["betfairRows"])
        except Exception as e:
            rec["status"] = "ERR:" + str(e)[:60]
            print(tid, "✗ 情报提取异常", e)
        report.append(rec)

    (out_dir / "_dqd_report.json").write_text(
        json.dumps({"n": len(manifest["matches"]), "report": report},
                   ensure_ascii=False, indent=1), encoding="utf-8")
    ok = sum(1 for r in report if r["status"] == "OK")
    print(f"[dqd] 完成 {ok}/{len(manifest['matches'])} 场，输出目录 {out_dir}")


if __name__ == "__main__":
    main()
