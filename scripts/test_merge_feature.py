#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
اختبار E2E لميزات الجلسة الحالية — محلي بالكامل ضد مزوّد وهمي،
بدون أي استدعاء توليد حقيقي ولا استهلاك رصيد (التوليد موقوف بأمر المستخدم).

يغطي:
1) واجهة الدمج: POST /api/merge لفيديوهين مكتملين → نجاح → ملف MP4 واحد
   يفحص بـ ffprobe (المدة ≈ مجموع الأجزاء) + دعم Range (206)
2) التحقق من صلاحية الدمج: صورة بدل فيديو / فيديو غير مكتمل / مقطع واحد / مقطع مفقود
3) أداة MCP الجديدة merge_videos (initialize + tools/list + tools/call)
4) سلسلة النماذج البديلة: نموذج فيديو معطل عند المزوّد (Internal error)
   → يتولد الفيديو تلقائيًا بنموذج بديل ويُسجَّل النموذج الفعلي
5) زر اختبار الاتصال: مفتاح صحيح → مقبول، مفتاح خاطئ → مرفوض (بلا أي تكلفة)
6) فحص الواجهة: 4 تبويبات فقط (انشاء الصور/انشاء الفيديوهات/MCP/الاعدادات)
   واختفاء شات جي بي تي وربط ChatGPT والنشر التلقائي
7) استعادة الافتراضي بعد الاختبار
"""
import json
import os
import subprocess
import sys
import time

import requests

DEV = os.environ.get("DEV_URL", "http://127.0.0.1:3000").rstrip("/")
MOCK = os.environ.get("MOCK_URL", "http://127.0.0.1:9091").rstrip("/")
KIE = f"{MOCK}/kieapi"
KEY = "mock-key-123"

passed = 0
failed = 0


def check(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ✅ {name}")
    else:
        failed += 1
        print(f"  ❌ {name} — {detail}")


def put_settings(**kwargs):
    return requests.put(f"{DEV}/api/settings", json=kwargs, timeout=30)


def poll_generation(gen_id, tries=6):
    item = None
    for _ in range(tries):
        r = requests.get(f"{DEV}/api/generations/{gen_id}?wait=8", timeout=60)
        item = r.json()["item"]
        if item["status"] in ("success", "fail"):
            return item
        time.sleep(0.5)
    return item


def make_video(prompt, with_image=False):
    body = {
        "type": "video",
        "prompt": prompt,
        "aspectRatio": "16:9",
        "resolution": "480p",
        "duration": 8,
        "enableAudio": True,
    }
    if with_image:
        body["imageUrls"] = [f"{MOCK}/assets/image.png"]
    r = requests.post(f"{DEV}/api/generate", json=body, timeout=60)
    assert r.status_code == 201, f"generate failed: {r.status_code} {r.text[:300]}"
    gen_id = r.json()["id"]
    item = poll_generation(gen_id)
    assert item["status"] == "success", f"video not success: {json.dumps(item, ensure_ascii=False)[:300]}"
    return item


def ffprobe(path):
    out = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            path,
        ],
        capture_output=True, text=True, timeout=30,
    )
    try:
        return float(out.stdout.strip())
    except ValueError:
        return None


print("=" * 70)
print("اختبار الدمج + النماذج البديلة + اختبار الاتصال — محلي بالكامل")
print(f"  dev={DEV}  mock={MOCK}")
print("=" * 70)

# ---------- 0) ضبط الإعدادات على المزوّد الوهمي (نمط kie) ----------
print("\n[0] ضبط الإعدادات على المزوّد الوهمي")
r = put_settings(
    baseUrl=KIE,
    apiKey=KEY,
    imageModel="kie-mock-image",
    videoModel="kie-mock-video",
)
check("PUT إعدادات نمط kie → 200", r.status_code == 200, f"{r.status_code} {r.text[:200]}")

# ---------- 1) زر اختبار الاتصال ----------
print("\n[1] اختبار الاتصال (بلا استهلاك رصيد)")
r = requests.post(
    f"{DEV}/api/settings/test",
    json={"baseUrl": KIE, "apiKey": KEY},
    timeout=30,
)
d = r.json()
check("اختبار الاتصال بمفتاح صحيح → ok", r.status_code == 200 and d.get("ok") is True, r.text[:300])
check("التصديق مقبول (authOk)", d.get("authOk") is True, r.text[:300])

r = requests.post(
    f"{DEV}/api/settings/test",
    json={"baseUrl": KIE, "apiKey": "wrong-key"},
    timeout=30,
)
d = r.json()
check("اختبار الاتصال بمفتاح خاطئ → مرفوض", r.status_code == 200 and d.get("authOk") is False, r.text[:300])
check("رسالة خطأ واضحة", "مرفوض" in (d.get("error") or ""), r.text[:300])

# ---------- 2) إنشاء فيديوهين مكتملين عبر المزوّد الوهمي ----------
print("\n[2] إنشاء فيديوهين مكتملين (واجهة المهام نمط kie)")
v1 = make_video("مقطع أول تجريبي للدمج — مشهد متحرك")
v2 = make_video("مقطع ثانٍ تجريبي للدمج — من صورة", with_image=True)
check("الفيديو 1 اكتمل بنجاح", v1["status"] == "success", str(v1)[:200])
check("الفيديو 2 اكتمل بنجاح (image-to-video)", v2["status"] == "success", str(v2)[:200])
check("روابط النتائج تشير للمزوّد الوهمي", v1["resultUrls"] and v1["resultUrls"][0].startswith(MOCK), str(v1["resultUrls"])[:200])

# ---------- 3) رفض حالات الدمج غير الصالحة ----------
print("\n[3] التحقق من صلاحية الدمج")
r = requests.post(f"{DEV}/api/merge", json={"generationIds": [v1["id"]]}, timeout=30)
check("مقطع واحد → 400 برسالة عربية", r.status_code == 400, r.text[:200])

r = requests.post(f"{DEV}/api/merge", json={"generationIds": ["nonexistent-id-xyz", v1["id"]]}, timeout=30)
check("مقطع مفقود → 400", r.status_code == 400, r.text[:200])

# صورة بدل فيديو
r = requests.post(f"{DEV}/api/generate", json={"type": "image", "prompt": "صورة تجربة", "aspectRatio": "1:1", "resolution": "1K"}, timeout=60)
img_id = r.json()["id"]
poll_generation(img_id)
r = requests.post(f"{DEV}/api/merge", json={"generationIds": [img_id, v1["id"]]}, timeout=30)
check("صورة ضمن المقاطع → 400 (الدمج للفيديوهات فقط)", r.status_code == 400 and "ليس فيديو" in r.text, r.text[:300])

# ---------- 4) الدمج الفعلي ----------
print("\n[4] دمج فيديوهين في مقطع واحد")
r = requests.post(f"{DEV}/api/merge", json={"generationIds": [v1["id"], v2["id"]]}, timeout=30)
d = r.json()
check("POST /api/merge → 201", r.status_code == 201, r.text[:300])
merge_id = d.get("id")
check("حالة الوظيفة processing أوليًا", d.get("status") == "processing", r.text[:300])

status = None
for _ in range(20):
    time.sleep(2)
    rr = requests.get(f"{DEV}/api/merge/{merge_id}", timeout=60)
    status = rr.json().get("item", {})
    if status.get("status") != "processing":
        break
check("اكتمل الدمج بنجاح", status and status.get("status") == "success", json.dumps(status, ensure_ascii=False)[:300])
check("رابط الملف الداخلي صحيح", status.get("fileUrl") == f"/api/merge/{merge_id}/file", str(status.get("fileUrl")))

rr = requests.get(f"{DEV}/api/merge/{merge_id}/file", timeout=120)
check("تنزيل الملف المدمج → 200 video/mp4", rr.status_code == 200 and "video/mp4" in rr.headers.get("Content-Type", ""), f"{rr.status_code} {rr.headers.get('Content-Type')}")
check("الملف غير فارغ", len(rr.content) > 10_000, f"{len(rr.content)} bytes")

with open("/tmp/merged-test.mp4", "wb") as f:
    f.write(rr.content)
dur = ffprobe("/tmp/merged-test.mp4")
check(f"مدة المقطع المدمج ≈ 4 ثوانٍ (2+2) — فعليًا {dur}", dur is not None and 3.5 <= dur <= 5.5, str(dur))

rr = requests.get(f"{DEV}/api/merge/{merge_id}/file", headers={"Range": "bytes=0-999"}, timeout=60)
check("دعم Range → 206 مع Content-Range", rr.status_code == 206 and rr.headers.get("Content-Range", "").startswith("bytes 0-999/"), f"{rr.status_code} {rr.headers.get('Content-Range')}")

rr = requests.get(f"{DEV}/api/merge", timeout=30)
items = rr.json().get("items", [])
check("قائمة الدمج تحتوي الوظيفة", any(m["id"] == merge_id for m in items), str(len(items)))

# ---------- 5) أداة MCP الجديدة merge_videos ----------
print("\n[5] أداة MCP merge_videos")
r = requests.post(
    f"{DEV}/mcp",
    json={"jsonrpc": "2.0", "id": 1, "method": "initialize",
          "params": {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "test", "version": "1.0"}}},
    timeout=30,
)
check("initialize MCP → 200", r.status_code == 200, r.text[:200])

r = requests.post(f"{DEV}/mcp", json={"jsonrpc": "2.0", "id": 2, "method": "tools/list"}, timeout=30)
names = [t["name"] for t in r.json().get("result", {}).get("tools", [])]
check("أداة merge_videos في tools/list", "merge_videos" in names, str(names))

r = requests.post(
    f"{DEV}/mcp",
    json={"jsonrpc": "2.0", "id": 3, "method": "tools/call",
          "params": {"name": "merge_videos", "arguments": {"ids": [v1["id"], v2["id"]], "wait_seconds": 30}}},
    timeout=120,
)
text = r.json().get("result", {}).get("content", [{}])[0].get("text", "{}")
payload = json.loads(text)
check("merge_videos عبر MCP → نجاح", payload.get("status") == "success", text[:300])
mcp_file = payload.get("fileUrl", "")
check("fileUrl مطلق عبر MCP", mcp_file.startswith("http"), mcp_file[:200])

rr = requests.get(mcp_file, timeout=120)
check("تنزيل ملف الدمج من رابط MCP → mp4", rr.status_code == 200 and "video/mp4" in rr.headers.get("Content-Type", ""), f"{rr.status_code}")
with open("/tmp/merged-mcp.mp4", "wb") as f:
    f.write(rr.content)
dur2 = ffprobe("/tmp/merged-mcp.mp4")
check(f"مدة مقطع MCP المدمج ≈ 4 ثوانٍ — فعليًا {dur2}", dur2 is not None and 3.5 <= dur2 <= 5.5, str(dur2))

# ---------- 6) النماذج البديلة: نموذج معطل → بديل تلقائي ----------
print("\n[6] سلسلة النماذج البديلة عند فشل النموذج الأساسي")
r = put_settings(videoModel="broken-video-model")
check("ضبط نموذج فيديو معطل", r.status_code == 200, r.text[:200])

body = {"type": "video", "prompt": "اختبار النموذج البديل", "aspectRatio": "auto", "resolution": "480p", "duration": 8, "enableAudio": True}
r = requests.post(f"{DEV}/api/generate", json=body, timeout=60)
check("إنشاء الفيديو ينجح رغم النموذج المعطل (بديل تلقائي)", r.status_code == 201, r.text[:400])
if r.status_code == 201:
    gen_id = r.json()["id"]
    item = poll_generation(gen_id)
    check("المهمة اكتملت بنجاح", item["status"] == "success", json.dumps(item, ensure_ascii=False)[:300])
    check("النموذج الفعلي المسجَّل هو البديل", item["model"] == "grok-imagine/text-to-video", item["model"])
    check("النموذج المسجَّل ≠ النموذج المعطل", item["model"] != "broken-video-model", item["model"])

# استعادة نموذج الفيديو
r = put_settings(videoModel="kie-mock-video")

# مفتاح مرفوض: لا بديل ولا فائدة — رسالة واضحة
r = put_settings(apiKey="wrong-key", videoModel="kie-mock-video")
body = {"type": "video", "prompt": "اختبار مفتاح مرفوض", "aspectRatio": "auto", "resolution": "480p", "duration": 8, "enableAudio": True}
r = requests.post(f"{DEV}/api/generate", json=body, timeout=60)
check("مفتاح خاطئ → 502 برسالة واضحة (لا بديل بلا فائدة)", r.status_code in (400, 502) and "مرفوض" in r.text, f"{r.status_code} {r.text[:300]}")
r = put_settings(apiKey=KEY)

# ---------- 7) فحص الواجهة: التبويبات الجديدة ----------
print("\n[7] فحص تبويبات الواجهة")
html = requests.get(f"{DEV}/", timeout=30).text
for label in ["انشاء الصور", "انشاء الفيديوهات", "MCP", "الاعدادات"]:
    check(f"تبويب «{label}» موجود", label in html, "غير موجود في الصفحة")
for removed in ["ربط ChatGPT", "شات جي بي تي", "النشر التلقائي", "الاستوديو"]:
    check(f"تبويب «{removed}» أُزيل", removed not in html, "لا يزال موجودًا")

# ---------- 8) حذف وظيفة دمج + استعادة الافتراضي ----------
print("\n[8] التنظيف")
rr = requests.delete(f"{DEV}/api/merge/{merge_id}", timeout=30)
check("حذف وظيفة الدمج → ok", rr.status_code == 200 and rr.json().get("ok") is True, rr.text[:200])
rr = requests.get(f"{DEV}/api/merge", timeout=30)
check("الوظيفة حُذفت من القائمة", not any(m["id"] == merge_id for m in rr.json().get("items", [])), "")
r = requests.delete(f"{DEV}/api/settings", timeout=30)
check("استعادة الإعدادات الافتراضية", r.status_code == 200, r.text[:200])

print("\n" + "=" * 70)
print(f"النتيجة: نجح {passed} — فشل {failed}")
print("=" * 70)
sys.exit(1 if failed else 0)
