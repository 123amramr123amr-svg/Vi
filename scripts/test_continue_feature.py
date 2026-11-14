#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
اختبار ميزة تكملة الفيديو (سلسلة الأجزاء) — بأمر المستخدم: بدون أي توليد فعلي.
كل الاختبارات هنا إما على قاعدة البيانات المحلية أو على أخطاء التحقق التي
تحدث قبل أي استدعاء لـ kie.ai — صفر استدعاءات توليد.
"""
import base64
import json
import sys
import urllib.error
import urllib.request

BASE = "http://localhost:3000"
passed, failed = [], []


def check(name, cond, detail=""):
    (passed if cond else failed).append(name)
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  -> {detail}"))


def req(path, method="GET", data=None, headers=None, raw=False):
    r = urllib.request.Request(BASE + path, method=method)
    for k, v in (headers or {}).items():
        r.add_header(k, v)
    body = None
    if data is not None:
        if isinstance(data, (dict, list)):
            body = json.dumps(data).encode()
            r.add_header("Content-Type", "application/json")
        else:
            body = data
    try:
        with urllib.request.urlopen(r, body, timeout=45) as resp:
            b = resp.read()
            if raw:
                return resp.status, b
            try:
                return resp.status, json.loads(b) if b else {}
            except Exception:
                return resp.status, b
    except urllib.error.HTTPError as e:
        b = e.read()
        if raw:
            return e.code, b
        try:
            return e.code, json.loads(b) if b else {}
        except Exception:
            return e.code, b
    except Exception as e:
        return -1, {"error": f"connection: {e}"}


# ---------- 1) OpenAPI: الحقول الجديدة ----------
s, schema = req("/api/openapi.json")
txt = json.dumps(schema)
check("openapi 200", s == 200, str(s))
for field in ["parentId", "imageUrls", "extendAt", "partNumber", "continue a finished video"]:
    check(f"openapi يحوي {field}", field in txt)

# ---------- 2) رفع صورة PNG صالحة وخدمتها ----------
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)
boundary = "----viboundary123"
mp = (
    f"--{boundary}\r\n"
    "Content-Disposition: form-data; name=\"file\"; filename=\"t.png\"\r\n"
    "Content-Type: image/png\r\n\r\n"
).encode() + PNG + f"\r\n--{boundary}--\r\n".encode()
s, up = req("/api/uploads", "POST", mp, {"Content-Type": f"multipart/form-data; boundary={boundary}"})
check("رفع صورة 201", s == 201 and str(up.get("url", "")).startswith("/api/uploads/"), f"{s} {up}")
url = up.get("url", "")
s, got = req(url, raw=True)
check("خدمة الصورة المرفوعة (نفس البايتات)", s == 200 and got == PNG, f"status={s} len={len(got)} vs {len(PNG)}")

# ---------- 3) رفض صيغة غير مدعومة ----------
mp2 = (
    f"--{boundary}\r\n"
    "Content-Disposition: form-data; name=\"file\"; filename=\"t.txt\"\r\n"
    "Content-Type: text/plain\r\n\r\n"
).encode() + b"hello" + f"\r\n--{boundary}--\r\n".encode()
s, err = req("/api/uploads", "POST", mp2, {"Content-Type": f"multipart/form-data; boundary={boundary}"})
check("رفض ملف نصي 400", s == 400, f"{s} {err}")

# ---------- 4) رفض حجم زائد (فوق 4 ميجا) ----------
big = b"\x89PNG\r\n\x1a\n" + b"0" * (4 * 1024 * 1024 + 10)
mp3 = (
    f"--{boundary}\r\n"
    "Content-Disposition: form-data; name=\"file\"; filename=\"big.png\"\r\n"
    "Content-Type: image/png\r\n\r\n"
).encode() + big + f"\r\n--{boundary}--\r\n".encode()
s, err = req("/api/uploads", "POST", mp3, {"Content-Type": f"multipart/form-data; boundary={boundary}"})
check("رفض صورة أكبر من 4 ميجا 400", s == 400, f"{s}")

# ---------- 5) تكملة بمعرّف أصل غير موجود → 400 قبل أي استدعاء للمزوّد ----------
MISSING = "00000000-0000-0000-0000-000000000000"
s, r = req("/api/generate", "POST", {"type": "video", "prompt": "اختبار", "parentId": MISSING})
check("تكملة بأصل مفقود → 400", s == 400 and "غير موجود" in str(r.get("error", "")), f"{s} {r}")

s, r = req("/api/generate", "POST", {"type": "video", "prompt": "اختبار", "parentId": "abc"})
check("parentId بغير صيغة UUID → 400", s == 400, f"{s} {r}")

s, r = req("/api/generate", "POST", {"type": "video", "prompt": "اختبار", "imageUrls": ["notaurl"]})
check("رابط صورة غير صالح → 400", s == 400 and "صورة" in str(r.get("error", "")), f"{s} {r}")

s, r = req("/api/generate", "POST", {"type": "video", "prompt": "اختبار", "imageUrls": ["https://a.com/1.png"] * 4})
check("أكثر من 3 صور → 400", s == 400, f"{s} {r}")

# ---------- 6) MCP: initialize / tools/list / continue_video بأصل مفقود ----------
s, init = req("/mcp", "POST", {"jsonrpc": "2.0", "id": 1, "method": "initialize",
                               "params": {"protocolVersion": "2025-03-26", "capabilities": {},
                                          "clientInfo": {"name": "t", "version": "0"}}})
check("MCP initialize", s == 200 and bool(init.get("result", {}).get("protocolVersion")), str(init)[:150])

s, tl = req("/mcp", "POST", {"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
tools = tl.get("result", {}).get("tools", [])
names = [t["name"] for t in tools]
check("MCP أدوات = 10 وتحوي continue_video وmerge_videos", "continue_video" in names and "merge_videos" in names and len(names) == 10, str(names))
cv_tool = next((t for t in tools if t["name"] == "continue_video"), {})
props = cv_tool.get("inputSchema", {}).get("properties", {})
check("مخطط continue_video يحوي mode/image_urls/duration",
      {"parent_id", "prompt", "mode", "image_urls", "duration"} <= set(props), str(list(props)))

s, cv = req("/mcp", "POST", {"jsonrpc": "2.0", "id": 3, "method": "tools/call",
                             "params": {"name": "continue_video",
                                        "arguments": {"parent_id": MISSING, "prompt": "next scene", "mode": "extend"}}})
res = cv.get("result", {})
check("MCP continue_video بأصل مفقود → isError دون استدعاء المزوّد",
      res.get("isError") is True, str(cv)[:200])

s, cv2 = req("/mcp", "POST", {"jsonrpc": "2.0", "id": 4, "method": "tools/call",
                              "params": {"name": "continue_video",
                                         "arguments": {"parent_id": MISSING, "prompt": "x", "mode": "images"}}})
check("MCP continue_video وضع images بلا صور → خطأ تحقق",
      cv2.get("result", {}).get("isError") is True or "error" in cv2, str(cv2)[:200])

s, notif = req("/mcp", "POST", {"jsonrpc": "2.0", "method": "notifications/initialized"})
check("MCP إشعار → 202", s == 202, str(s))

# ---------- 7) فحص صحة عام ----------
s, health = req("/api")
check("GET /api يعمل", s == 200, f"{s}")

print(f"\n===== {len(passed)} نجح / {len(failed)} فشل =====")
sys.exit(1 if failed else 0)
