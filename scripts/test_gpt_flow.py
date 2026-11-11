"""محاكاة تدفق ChatGPT Actions كاملًا على تطبيق Vi:
1) التحقق من مخطط /api/openapi.json
2) صفحة /privacy
3) listGenerations
4) createGeneration (صورة)
5) getGeneration?wait=8 حتى الاكتمال (كما يفعل الـ GPT)
6) التأكد من قابلية تحميل النتيجة
7) deleteGeneration للتنظيف
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


# 1) مخطط OpenAPI
st, schema = req("GET", "/api/openapi.json")
ops = []
for path_item in schema["paths"].values():
    for op in path_item.values():
        if isinstance(op, dict) and "operationId" in op:
            ops.append(op["operationId"])
assert schema["openapi"] == "3.1.0", schema["openapi"]
assert schema["servers"][0]["url"].startswith("http"), schema["servers"]
assert len(ops) == len(set(ops)) == 4, ops
assert set(ops) == {
    "createGeneration",
    "getGeneration",
    "listGenerations",
    "deleteGeneration",
}, ops
print("1) SCHEMA OK — server:", schema["servers"][0]["url"], "ops:", sorted(ops))

# 2) صفحة الخصوصية
st, html = get_html("/privacy")
assert st == 200 and "سياسة الخصوصية" in html
print("2) PRIVACY PAGE OK")

# 3) قائمة العمليات
st, listing = req("GET", "/api/generations")
assert isinstance(listing.get("items"), list)
print("3) LIST OK —", len(listing["items"]), "items")

# 4) إنشاء مهمة صورة (كما يفعل ChatGPT)
st, created = req(
    "POST",
    "/api/generate",
    {
        "type": "image",
        "prompt": "A tiny robot artist painting a glowing purple sunset on a canvas, digital art, warm lighting, highly detailed",
        "aspectRatio": "1:1",
        "resolution": "1K",
    },
)
assert st == 201 and created.get("id"), (st, created)
gid = created["id"]
print("4) CREATE OK — id:", gid, "status:", created.get("status"))

# 5) متابعة بالاستعلام wait=8 حتى النهاية
deadline = time.time() + 240
final = None
calls = 0
while time.time() < deadline:
    st, data = req("GET", f"/api/generations/{gid}?wait=8")
    calls += 1
    item = data["item"]
    print(f"   poll#{calls} status={item['status']}")
    if item["status"] in ("success", "fail"):
        final = item
        break
assert final is not None and final["status"] == "success", final
assert final["resultUrls"], final
print("5) POLL OK after", calls, "calls — resultUrls:", final["resultUrls"])

# 6) تحميل النتيجة
url = final["resultUrls"][0]
with urllib.request.urlopen(url, timeout=90) as res:
    size = len(res.read())
assert size > 10000, size
print("6) DOWNLOAD OK —", size, "bytes")

# 7) حذف صف الاختبار (تنظيف)
st, d = req("DELETE", f"/api/generations/{gid}")
assert d.get("ok") is True
st, listing2 = req("GET", "/api/generations")
assert gid not in [i["id"] for i in listing2["items"]]
print("7) DELETE OK — test row removed")

print("ALL GPT-FLOW TESTS PASSED ✅")
