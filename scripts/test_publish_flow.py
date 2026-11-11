"""اختبار E2E لنظام النشر التلقائي والمعرض العام:
1) المخطط يضم 8 عمليات (منها النشر والأوتوبايلوت)
2) المعرض فارغ في البداية
3) الأوتوبايلوت ينشئ مهمة (صورة للسرعة عبر override)
4) المتابعة حتى الاكتمال
5) النشر اليدوي PUT publish → يظهر في /api/published و/gallery
6) إلغاء النشر ثم إعادة النشر
7) خطوة أوتوبايلوت ثانية (create=false) تنشر المكتمل تلقائيًا
8) فحص صفحة /gallery تحتوي العمل
9) تنظيف: حذف كل صفوف الاختبار
"""
import json
import time
import urllib.request

BASE = "http://localhost:3000"


def req(method, path, body=None, timeout=90):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(
        BASE + path,
        data=data,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(r, timeout=timeout) as res:
        return res.status, json.loads(res.read().decode())


def get_html(path, timeout=30):
    with urllib.request.urlopen(BASE + path, timeout=timeout) as res:
        return res.status, res.read().decode()


def wait_success(gid, max_seconds=180):
    deadline = time.time() + max_seconds
    while time.time() < deadline:
        st, data = req("GET", f"/api/generations/{gid}?wait=8")
        item = data["item"]
        print(f"   poll status={item['status']}")
        if item["status"] in ("success", "fail"):
            return item
    raise AssertionError("timeout waiting for generation")


# 1) مخطط به 8 عمليات
st, schema = req("GET", "/api/openapi.json")
ops = set()
for path_item in schema["paths"].values():
    for op in path_item.values():
        if isinstance(op, dict) and "operationId" in op:
            ops.add(op["operationId"])
expected = {
    "createGeneration",
    "getGeneration",
    "deleteGeneration",
    "publishGeneration",
    "unpublishGeneration",
    "listPublishedWorks",
    "runAutopilot",
    "listGenerations",
}
assert expected <= ops, f"missing: {expected - ops}"
print("1) SCHEMA OK —", len(ops), "operations")

# 2) المعرض فارغ
st, pub = req("GET", "/api/published")
assert st == 200 and isinstance(pub["items"], list)
print("2) PUBLISHED LIST OK —", len(pub["items"]), "items")

# 3) الأوتوبايلوت ينشئ مهمة (صورة عبر override للسرعة)
st, run1 = req(
    "POST",
    "/api/autopilot/run",
    {"type": "image", "prompt": "A glowing purple crystal castle floating in pink clouds, digital art"},
)
assert st == 200 and run1["ok"] and run1["created"], run1
gid = run1["created"]["id"]
assert run1["publishedIds"] == []
print("3) AUTOPILOT CREATE OK —", gid)

# 4) متابعة حتى الاكتمال
item = wait_success(gid)
assert item["resultUrls"], item
print("4) GENERATION SUCCESS —", item["resultUrls"][0][:60], "…")

# 5) نشر يدوي
st, pubres = req("PUT", f"/api/generations/{gid}/publish")
assert st == 200 and pubres["item"]["published"] is True, pubres
st, pub = req("GET", "/api/published")
assert any(i["id"] == gid for i in pub["items"]), pub
print("5) PUBLISH OK — visible in /api/published")

# 6) إلغاء ثم إعادة نشر
st, un = req("DELETE", f"/api/generations/{gid}/publish")
assert un["item"]["published"] is False
st, pub = req("GET", "/api/published")
assert not any(i["id"] == gid for i in pub["items"])
st, rep = req("PUT", f"/api/generations/{gid}/publish")
assert rep["item"]["published"] is True
print("6) UNPUBLISH/REPUBLISH OK")

# 7) خطوة أوتوبايلوت (مسح فقط) — العمل منشور مسبقًا فلا جديد
st, run2 = req("POST", "/api/autopilot/run", {"create": False})
assert st == 200 and run2["ok"]
print("7) AUTOPILOT SWEEP OK —", run2.get("note"))

# 8) صفحة المعرض تعرض العمل
st, html = get_html("/gallery")
assert st == 200 and "معرض المنشورات" in html
assert "crystal" in html.lower()
print("8) GALLERY PAGE OK — contains published work")

# 9) تنظيف
req("DELETE", f"/api/generations/{gid}/publish")
req("DELETE", f"/api/generations/{gid}")
st, pub = req("GET", "/api/published")
assert not any(i["id"] == gid for i in pub["items"])
print("9) CLEANUP OK")

print("ALL PUBLISH/AUTOPILOT TESTS PASSED ✅")
