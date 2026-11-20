# -*- coding: utf-8 -*-
import glob
import json
import os

base = r"C:\Users\Administrator\DoubaoWork\chats\2026-11-07\new-chat\jc-football-report-main"
for p in sorted(glob.glob(os.path.join(base, "data", "raw*", "_dqd_consensus.json"))):
    d = json.load(open(p, encoding="utf-8"))
    mt = d.get("matched") or []
    tag = os.path.basename(os.path.dirname(p))
    has_dist = sum(1 for x in mt if x.get("expertDist"))
    has_mid = sum(1 for x in mt if x.get("mid"))
    print(f"{tag}: total={d.get('total')} matched={len(mt)} missed={len(d.get('missed') or [])} dist={has_dist} mid={has_mid}")
    if mt[:1]:
        k = mt[0]
        print("   keys:", sorted(k.keys())[:14])
        print("   sample:", k.get("home"), "vs", k.get("away"), "| mid", k.get("mid"), "| dist0", (k.get("expertDist") or [None])[0])
