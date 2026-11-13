#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
اختبار E2E لميزة «أي رابط لأي مفتاح» في تبويب الإعدادات — محلي بالكامل.

يُشغَّل ضد خادم التطوير المحلي (:3000) وخادم مزوّد وهمي محلي (:9091) —
لا يتصل بأي مزوّد حقيقي ولا يستهلك أي رصيد توليد (التوليد موقوف بأمر المستخدم).

يغطي:
1) حفظ رابط يحتوي مسارًا كما هو (الإصلاح المطلوب: مش بس https://api.kie.ai)
2) رفض الروابط غير الصالحة
3) جلب النماذج من مزوّد بنمط OpenAI (رابط بمسار /oai/v1)
4) جلب النماذج من مزوّد بنمط kie (رابط بمسار مخصص /kieapi)
5) توليد صورة فوري عبر الواجهة المتوافقة مع OpenAI
6) فيديو عبر واجهة OpenAI غير المتزامنة (استعلام دوري + رابط عام)
7) فيديو بلا رابط عام → بروكسي الوسائط /api/media
8) فيديو عبر واجهة المهام (نمط kie) بمسار مخصص
9) رفض مفتاح خاطئ → الرجوع للكتالوج مع رسالة
10) استعادة الافتراضي بعد الاختبار
"""
import json
import os
import sys
import time

import requests

DEV = os.environ.get("DEV_URL", "http://127.0.0.1:3000").rstrip("/")
MOCK = os.environ.get("MOCK_URL", "http://127.0.0.1:9091").rstrip("/")
OAI = f"{MOCK}/oai/v1"
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


def get_settings():
    return requests.get(f"{DEV}/api/settings", timeout=30).json()["settings"]


def poll_until(gen_id, want="success", tries=6):
    for _ in range(tries):
        r = requests.get(f"{DEV}/api/generations/{gen_id}?wait=8", timeout=60)
        item = r.json()["item"]
        if item["status"] in ("success", "fail"):
            return item
        time.sleep(0.5)
    return item


print("=" * 70)
print("اختبار أي رابط لأي مفتاح — محلي بالكامل (مزوّد وهمي، بلا تكاليف)")
print(f"  dev={DEV}  mock={MOCK}")
print("=" * 70)

# تنظيف مسبق: استعادة الافتراضي قبل البدء
requests.delete(f"{DEV}/api/settings", timeout=30)

# ---------- 1) حفظ رابط بمسار كما هو ----------
print("\n[1] حفظ رابط يحتوي مسارًا (مثل openrouter) كما هو بدون قطع")
r = put_settings(baseUrl=OAI)
check("PUT رابط بمسار → 200", r.status_code == 200, f"{r.status_code} {r.text[:200]}")
s = get_settings()
check(
    "الرابط محفوظ كاملًا مع المسار",
    s["baseUrl"] == OAI,
    f"got: {s['baseUrl']}",
)

print("\n[1-ب] اقتطاع نقطة النهاية إذا لُصقت كاملة")
r = put_settings(baseUrl=f"{OAI}/models")
s = get_settings()
check("…/models يُقتطع إلى الأساس", s["baseUrl"] == OAI, f"got: {s['baseUrl']}")

# ---------- 2) رفض رابط غير صالح ----------
print("\n[2] رفض رابط غير صالح")
r = put_settings(baseUrl="هذا رابط غير صالح @@")
check("رابط فاسد → 400", r.status_code == 400, f"{r.status_code} {r.text[:150]}")

# ---------- 3) جلب النماذج من نمط OpenAI ----------
print("\n[3] جلب النماذج من مزوّد بنمط OpenAI (رابط بمسار)")
r = requests.post(
    f"{DEV}/api/settings/models", json={"baseUrl": OAI, "apiKey": KEY}, timeout=60
)
data = r.json()
check("POST models → ok", r.status_code == 200 and data.get("ok"), f"{r.text[:200]}")
check("المصدر provider", data.get("source") == "provider", str(data.get("source")))
ids = data.get("models", [])
check("يحتوي oai-mock-image", "oai-mock-image" in ids, str(ids[:8]))
check("يحتوي oai-mock-video", "oai-mock-video" in ids, str(ids[:8]))
check(
    "النقطة المستخدمة هي /oai/v1/models",
    data.get("endpoint") == f"{OAI}/models",
    str(data.get("endpoint")),
)

# ---------- 4) جلب النماذج من نمط kie بمسار مخصص ----------
print("\n[4] جلب النماذج من مزوّد بنمط kie (مسار مخصص /kieapi)")
r = requests.post(
    f"{DEV}/api/settings/models", json={"baseUrl": KIE, "apiKey": KEY}, timeout=60
)
data = r.json()
check("POST models → ok", r.status_code == 200 and data.get("ok"), f"{r.text[:200]}")
ids = data.get("models", [])
check("يحتوي kie-mock-image", "kie-mock-image" in ids, str(ids[:8]))
check("يحتوي kie-mock-video", "kie-mock-video" in ids, str(ids[:8]))

# ---------- 5) صورة عبر الواجهة المتوافقة مع OpenAI ----------
print("\n[5] توليد صورة (واجهة OpenAI متزامنة → نجاح فوري)")
r = put_settings(
    baseUrl=OAI, apiKey=KEY, imageModel="oai-mock-image", videoModel="oai-mock-video"
)
check("حفظ النماذج والرابط والمفتاح", r.status_code == 200, r.text[:200])
r = requests.post(
    f"{DEV}/api/generate", json={"type": "image", "prompt": "قطة على القمر"}, timeout=60
)
check("POST generate → 201", r.status_code == 201, f"{r.status_code} {r.text[:200]}")
gid = r.json()["id"]
r = requests.get(f"{DEV}/api/generations/{gid}", timeout=30)
item = r.json()["item"]
check("الحالة success فورًا", item["status"] == "success", item["status"])
check(
    "رابط النتيجة من المزوّد الوهمي",
    item["resultUrls"] == [f"{MOCK}/assets/image.png"],
    str(item["resultUrls"]),
)
snap = item.get("params", {}).get("provider", {})
check(
    "لقطة المزوّد محفوظة (openai-image + prefix)",
    snap.get("kind") == "openai-image" and snap.get("prefix") == OAI,
    str(snap),
)

# ---------- 6) فيديو عبر واجهة OpenAI غير المتزامنة ----------
print("\n[6] فيديو عبر واجهة OpenAI (استعلام دوري حتى النجاح برابط عام)")
r = requests.post(
    f"{DEV}/api/generate",
    json={"type": "video", "prompt": "كلب يجري", "duration": 10, "aspectRatio": "16:9", "resolution": "720p"},
    timeout=60,
)
check("POST generate → 201", r.status_code == 201, f"{r.status_code} {r.text[:200]}")
vid1 = r.json()["id"]
item = poll_until(vid1)
check("الحالة success", item["status"] == "success", f"{item['status']} {item.get('error')}")
check(
    "الرابط العام من المزوّد",
    item["resultUrls"] == [f"{MOCK}/assets/video.mp4"],
    str(item["resultUrls"]),
)
snap = item.get("params", {}).get("provider", {})
check(
    "لقطة المزوّد (openai-video)",
    snap.get("kind") == "openai-video" and snap.get("prefix") == OAI,
    str(snap),
)

# ---------- 7) فيديو بلا رابط عام → بروكسي الوسائط ----------
print("\n[7] فيديو بلا رابط عام → يُخدم عبر بروكسي /api/media")
r = requests.post(
    f"{DEV}/api/generate",
    json={"type": "video", "prompt": "حصان يجري", "duration": 8, "aspectRatio": "16:9"},
    timeout=60,
)
check("POST generate → 201", r.status_code == 201, f"{r.status_code} {r.text[:200]}")
vid2 = r.json()["id"]
item = poll_until(vid2)
check("الحالة success", item["status"] == "success", f"{item['status']} {item.get('error')}")
media_url = item["resultUrls"][0] if item["resultUrls"] else ""
check("الرابط الداخلي /api/media/", "/api/media/" in media_url, media_url)
media_full = media_url if media_url.startswith("http") else f"{DEV}{media_url}"
r = requests.get(media_full, timeout=60)
check("البروكسي يعيد البايتات الصحيحة", r.content == b"MOCK-VIDEO-BYTES-0123456789", r.content[:50])
check("نوع المحتوى video/mp4", r.headers.get("content-type", "").startswith("video/mp4"), r.headers.get("content-type"))

# ---------- 8) فيديو عبر واجهة المهام (نمط kie) بمسار مخصص ----------
print("\n[8] فيديو عبر واجهة المهام (نمط kie) برابط مسار مخصص")
r = put_settings(
    baseUrl=KIE, apiKey=KEY, imageModel="kie-mock-image", videoModel="kie-mock-video"
)
check("تحويل الرابط إلى مزوّد kie", r.status_code == 200, r.text[:200])
r = requests.post(
    f"{DEV}/api/generate",
    json={"type": "video", "prompt": "سمكة تسبح", "duration": 8, "aspectRatio": "16:9"},
    timeout=60,
)
check("POST generate → 201", r.status_code == 201, f"{r.status_code} {r.text[:200]}")
kid = r.json()["id"]
check("المهمة في الانتظار أولًا", r.json()["status"] == "waiting", r.json()["status"])
item = poll_until(kid)
check("الحالة success", item["status"] == "success", f"{item['status']} {item.get('error')}")
check(
    "الرابط من recordInfo/resultJson",
    item["resultUrls"] == [f"{MOCK}/assets/video.mp4"],
    str(item["resultUrls"]),
)
snap = item.get("params", {}).get("provider", {})
check(
    "لقطة المزوّد (jobs + prefix صحيح)",
    snap.get("kind") == "jobs" and snap.get("prefix") == f"{KIE}/api/v1/jobs",
    str(snap),
)

# ---------- 9) مفتاح خاطئ → كتالوج احتياطي مع رسالة ----------
print("\n[9] مفتاح خاطئ → رفض 401 من كل النقاط → كتالوج احتياطي")
r = requests.post(
    f"{DEV}/api/settings/models", json={"baseUrl": OAI, "apiKey": "wrong-key"}, timeout=60
)
data = r.json()
check("الرد ok مع المصدر catalog", data.get("source") == "catalog", str(data.get("source")))
check("يوجد محاولات مسجلة", len(data.get("attempts", [])) >= 1, str(data.get("attempts")))

# ---------- 10) استعادة الافتراضي ----------
print("\n[10] استعادة الافتراضي بعد الاختبار")
r = requests.delete(f"{DEV}/api/settings", timeout=30)
check("DELETE → ok", r.status_code == 200 and r.json().get("ok"), r.text[:150])
s = get_settings()
check("الرابط رجع للافتراضي", s["baseUrl"] == "https://api.kie.ai", s["baseUrl"])
check("لا مفتاح مخصص", not s["hasCustomKey"], str(s["hasCustomKey"]))

print("\n" + "=" * 70)
print(f"النتيجة: نجح {passed} — فشل {failed}")
print("=" * 70)
sys.exit(1 if failed else 0)
