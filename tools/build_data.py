# -*- coding: utf-8 -*-
"""work/kanjivg/*.svg から app/data/kana.js を作る。
出力は { "あ": {"s": [pathD...], "n": [[x,y]...] } } の形。viewBox は 109x109。
ひらがな(U+3041-U+3096) と カタカナ(U+30A1-U+30FC) の両方。
"""
import os, re, json, sys
sys.stdout.reconfigure(encoding="utf-8")

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "work", "kanjivg")
DST = os.path.join(HERE, "..", "app", "data", "kana.js")
os.makedirs(os.path.dirname(DST), exist_ok=True)

RANGES = [range(0x3041, 0x3097), range(0x30a1, 0x30fd)]

PATH_RE = re.compile(r'<path id="kvg:([0-9a-f]+)-s(\d+)"[^>]*\sd="([^"]+)"')
NUM_RE = re.compile(r'<text transform="matrix\(1 0 0 1 ([\-\d.]+) ([\-\d.]+)\)">(\d+)</text>')

data = {}
for cp in [c for r in RANGES for c in r]:
    p = os.path.join(SRC, "%05x.svg" % cp)
    if not os.path.exists(p):
        continue
    svg = open(p, encoding="utf-8").read()
    strokes = [(int(m.group(2)), m.group(3)) for m in PATH_RE.finditer(svg)]
    strokes.sort(key=lambda t: t[0])
    nums = [(int(m.group(3)), round(float(m.group(1)), 1), round(float(m.group(2)), 1))
            for m in NUM_RE.finditer(svg)]
    nums.sort(key=lambda t: t[0])
    if not strokes:
        print("no strokes:", chr(cp)); continue
    data[chr(cp)] = {"s": [d for _, d in strokes],
                     "n": [[x, y] for _, x, y in nums]}

body = "// KanjiVG (https://kanjivg.tagaini.net) CC BY-SA 3.0 のストロークデータから生成。\n"
body += "// 生成: tools/build_data.py — 手で編集しない。\n"
body += "export const VIEWBOX = 109;\n"
body += "export const KANA = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n"
open(DST, "w", encoding="utf-8").write(body)

hira = [c for c in data if 0x3041 <= ord(c) <= 0x3096]
kata = [c for c in data if 0x30a1 <= ord(c) <= 0x30fc]
n = sum(len(v["s"]) for v in data.values())
print("ひらがな%d字 / カタカナ%d字 / %d画  bytes=%d" % (len(hira), len(kata), n, len(body.encode("utf-8"))))
mism = [c for c, v in data.items() if len(v["n"]) != len(v["s"])]
print("番号数とストローク数の不一致:", "".join(mism) or "なし")
