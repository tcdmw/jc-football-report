import json, os, glob

base = r"C:\Users\Administrator\DoubaoWork\chats\2026-11-07\new-chat\jc-football-report-main"
meta = json.load(open(os.path.join(base,"data","test","meta_0100_10.json"),encoding="utf-8"))
rawdir = os.path.join(base,"data","raw31")

for mt in meta["matches"]:
    i = mt["id"]
    lines = open(os.path.join(rawdir,i+".txt"),encoding="utf-8").read().split("\n")
    # 找数据对比表头行（含 同主客）
    hdr_idx = next(k for k,l in enumerate(lines) if "同主客" in l)
    hdr = lines[hdr_idx].split("\t")
    # 下面两行是主客队
    drow = []
    for k in range(hdr_idx+1, min(hdr_idx+4,len(lines))):
        c = lines[k].split("\t")
        if len(c) >= 15:
            drow.append(c)
    print("=== ", i, mt["home"], "vs", mt["away"])
    print(" hdr tabs:", len(hdr), hdr)
    for c in drow:
        print(" row tabs:", len(c), c[0], "| same-side:", c[10:14])
