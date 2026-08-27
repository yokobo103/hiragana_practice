# -*- coding: utf-8 -*-
"""KanjiVG からひらがな(U+3041-U+3096)とカタカナ(U+30A1-U+30FC)のSVGを取得して work/kanjivg/ に保存する。
KanjiVG: https://kanjivg.tagaini.net/  (CC BY-SA 3.0)
"""
import os, sys, time, urllib.request

BASE = "https://raw.githubusercontent.com/KanjiVG/kanjivg/master/kanji/%s.svg"
OUT = os.path.join(os.path.dirname(__file__), "..", "work", "kanjivg")
os.makedirs(OUT, exist_ok=True)

ok, ng = [], []
RANGES = [range(0x3041, 0x3097), range(0x30a1, 0x30fd)]
for cp in [c for r in RANGES for c in r]:
    name = "%05x" % cp
    dest = os.path.join(OUT, name + ".svg")
    if os.path.exists(dest) and os.path.getsize(dest) > 200:
        ok.append(chr(cp)); continue
    try:
        with urllib.request.urlopen(BASE % name, timeout=20) as r:
            data = r.read()
        with open(dest, "wb") as f:
            f.write(data)
        ok.append(chr(cp))
    except Exception as e:
        ng.append((chr(cp), name, str(e)[:60]))
    time.sleep(0.05)

print("OK  %d: %s" % (len(ok), "".join(ok)))
print("NG  %d: %s" % (len(ng), " ".join("%s(%s)" % (c, n) for c, n, _ in ng)))
