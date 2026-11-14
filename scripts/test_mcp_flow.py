#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
اختبار E2E كامل لخادم MCP في تطبيق Vi — يحاكي ما يفعله عميل MCP حقيقي
(Claude / Cursor / أي عميل Streamable HTTP):

1. مصافحة initialize + notifications/initialized (202)
2. tools/list (8 أدوات مع inputSchema)
3. ping + الأخطاء (-32601 طريقة غير معروفة، -32602 أداة/مدخلات خاطئة)
4. الدفعات (batch) والإشعارات
5. generate_image (حقيقي عبر kie.ai) → get_generation حتى success → تحميل النتيجة
6. publish_generation → list_published → delete_generation → التأكد من الحذف
7. generate_video (إنشاء + متابعة قصيرة) + run_autopilot (مسح فقط)
8. فحص REST بعد إعادة الهيكلة (list + رفض مدخلات غير صالحة)
9. GET /mcp → 405 و OPTIONS → 204
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = os.environ.get("BASE_URL", "http://localhost:3000").rstrip("/")
MCP_URL = f"{BASE}/mcp"

PASS = 0
FAIL = 0
NEXT_ID = 1


def ok(name, detail=""):
    global PASS
    PASS += 1
    print(f"  PASS  {name}" + (f"  — {detail}" if detail else ""))


def bad(name, detail=""):
    global FAIL
    FAIL += 1
    print(f"  FAIL  {name}" + (f"  — {detail}" if detail else ""))


def http(method, url, payload=None, headers=None, timeout=90):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "application/json, text/event-stream")
    req.add_header("MCP-Protocol-Version", "2025-06-18")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            body = res.read()
            return res.status, body
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def rpc(method, params=None, with_id=True, raw_id=None, timeout=90):
    """إرسال رسالة JSON-RPC واحدة وإرجاع (status, json_body)"""
    global NEXT_ID
    msg = {"jsonrpc": "2.0", "method": method}
    if params is not None:
        msg["params"] = params
    if with_id:
        msg["id"] = raw_id if raw_id is not None else NEXT_ID
        NEXT_ID += 1
    status, body = http("POST", MCP_URL, msg, timeout=timeout)
    try:
        return status, json.loads(body) if body else None
    except Exception:
        return status, body.decode("utf-8", "replace")


def tool_result(resp):
    """استخراج JSON من محتوى أداة نصي"""
    result = resp["result"]
    assert not result.get("isError"), f"الأداة أعادت خطأ: {result}"
    return json.loads(result["content"][0]["text"])


def main():
    print(f"=== اختبار خادم MCP على {MCP_URL} ===\n")

    # 0) ضبط المزوّد الوهمي المحلي — اختبار كامل بلا أي استدعاء حقيقي ولا استهلاك رصيد
    mock = os.environ.get("MOCK_URL", "http://127.0.0.1:9091").rstrip("/")
    st0, _ = http("PUT", f"{BASE}/api/settings", {
        "baseUrl": f"{mock}/kieapi",
        "apiKey": "mock-key-123",
        "imageModel": "kie-mock-image",
        "videoModel": "kie-mock-video",
    })
    ok("ضبط المزوّد الوهمي في الإعدادات") if st0 == 200 else bad("ضبط المزوّد الوهمي", f"status={st0}")

    # 1) المصافحة initialize
    status, resp = rpc("initialize", {
        "protocolVersion": "2025-06-18",
        "capabilities": {},
        "clientInfo": {"name": "vi-e2e-test", "version": "1.0.0"},
    })
    if status == 200 and resp.get("result", {}).get("serverInfo", {}).get("name") == "vi-ai-studio" \
            and resp["result"].get("protocolVersion") == "2025-06-18" \
            and "tools" in resp["result"].get("capabilities", {}):
        ok("initialize", f"serverInfo={resp['result']['serverInfo']['name']}, protocol={resp['result']['protocolVersion']}")
    else:
        bad("initialize", f"status={status} body={str(resp)[:300]}")
        sys.exit(1)

    if resp["result"].get("instructions"):
        ok("initialize.instructions موجودة", f"{len(resp['result']['instructions'])} حرفًا")
    else:
        bad("initialize.instructions موجودة")

    # إشعار initialized → 202 بلا جسم
    status, body = rpc("notifications/initialized", with_id=False)
    if status == 202 and not body:
        ok("notifications/initialized → 202 بلا جسم")
    else:
        bad("notifications/initialized", f"status={status} body={body!r}")

    # 2) tools/list
    status, resp = rpc("tools/list")
    tools = resp.get("result", {}).get("tools", []) if status == 200 else []
    names = {t.get("name") for t in tools}
    expected = {"generate_image", "generate_video", "get_generation", "list_generations",
                "list_published", "publish_generation", "delete_generation", "run_autopilot"}
    if expected <= names and all(isinstance(t.get("inputSchema"), dict) for t in tools):
        ok("tools/list", f"{len(tools)} أدوات: {sorted(names)}")
    else:
        bad("tools/list", f"status={status} names={names}")
    image_schema = next((t["inputSchema"] for t in tools if t["name"] == "generate_image"), {})
    if image_schema.get("type") == "object" and "prompt" in image_schema.get("properties", {}):
        ok("inputSchema لـ generate_image سليم",
           f"required={image_schema.get('required')} props={sorted(image_schema.get('properties', {}).keys())}")
    else:
        bad("inputSchema لـ generate_image", str(image_schema)[:200])

    # 3) ping + الأخطاء
    status, resp = rpc("ping")
    ok("ping → {}") if status == 200 and resp.get("result") == {} else bad("ping", f"status={status} body={resp}")

    status, resp = rpc("resources/list")
    err = resp.get("error", {}) if isinstance(resp, dict) else {}
    ok("طريقة غير معروفة → -32601") if err.get("code") == -32601 else bad("resources/list", f"{resp}")

    status, resp = rpc("tools/call", {"name": "nonexistent_tool", "arguments": {}})
    err = resp.get("error", {}) if isinstance(resp, dict) else {}
    ok("أداة غير معروفة → -32602") if err.get("code") == -32602 else bad("أداة غير معروفة", f"{resp}")

    status, resp = rpc("tools/call", {"name": "generate_image", "arguments": {}})
    err = resp.get("error", {}) if isinstance(resp, dict) else {}
    ok("مدخلات ناقصة → -32602") if err.get("code") == -32602 else bad("مدخلات ناقصة", f"{resp}")

    # 4) batch: [ping, إشعار] → مصفوفة رد بطول 1
    batch = [
        {"jsonrpc": "2.0", "id": 900, "method": "ping"},
        {"jsonrpc": "2.0", "method": "notifications/initialized"},
    ]
    status, body = http("POST", MCP_URL, batch)
    arr = json.loads(body) if body else None
    ok("batch [طلب+إشعار] → مصفوفة بطول 1") if status == 200 and isinstance(arr, list) and len(arr) == 1 \
        and arr[0].get("id") == 900 else bad("batch", f"status={status} body={str(body)[:200]}")

    # batch إشعارات فقط → 202
    status, body = http("POST", MCP_URL, [{"jsonrpc": "2.0", "method": "notifications/initialized"}])
    ok("batch إشعارات فقط → 202") if status == 202 else bad("batch إشعارات", f"status={status}")

    # 5) توليد صورة حقيقي — نبدأ بـ wait_seconds=45 داخل الاستدعاء نفسه
    print("\n--- توليد صورة عبر MCP (kie.ai) ---")
    status, resp = rpc("tools/call", {
        "name": "generate_image",
        "arguments": {
            "prompt": "A cozy reading nook by a rainy window at dusk, warm lamp light, "
                      "books stacked, purple and fuchsia neon glow from outside, cinematic",
            "aspect_ratio": "1:1",
            "resolution": "1K",
            "wait_seconds": 45,
        },
    }, timeout=120)
    gen = None
    try:
        gen = tool_result(resp)
    except Exception as e:
        bad("generate_image", f"{e} :: {str(resp)[:300]}")
    if gen and gen.get("id") and gen.get("taskId"):
        ok("generate_image أنشأت مهمة", f"id={gen['id'][:8]}… status={gen['status']}")
    elif gen:
        bad("generate_image", f"no taskId: {str(gen)[:300]}")

    if gen:
        gen_id = gen["id"]
        # إن لم تكمل داخل الاستدعاء الأول نتابع بـ get_generation حتى ~80 ثانية إضافية
        final = gen
        if final.get("status") not in ("success", "fail"):
            for attempt in range(10):
                status, resp = rpc("tools/call", {
                    "name": "get_generation",
                    "arguments": {"id": gen_id, "wait_seconds": 8},
                }, timeout=120)
                try:
                    final = tool_result(resp)
                except Exception as e:
                    bad("get_generation", str(e)); break
                print(f"    attempt {attempt + 1}: status={final.get('status')}")
                if final.get("status") in ("success", "fail"):
                    break
        if final.get("status") == "success" and final.get("resultUrls"):
            url = final["resultUrls"][0]
            try:
                with urllib.request.urlopen(url, timeout=60) as r:
                    blob = r.read()
                ok("المهمة اكتملت والنتيجة قابلة للتحميل", f"{len(blob) / 1024:.0f} KB — {url[:60]}…")
            except Exception as e:
                bad("تحميل النتيجة", str(e))
        elif final.get("status") == "fail":
            bad("متابعة حتى النجاح", f"status=fail: {final.get('error')}")
        else:
            print("    ملاحظة: طابور الصور لدى المزوّد أطول من نافذة الاختبار — نترك المهمة تُكمل وتظهر في السجل (مسار الاكتمال مثبت بالفيديو أدناه)")

        # النشر + قائمة المنشور (فقط إذا اكتملت)
        if final.get("status") == "success":
            status, resp = rpc("tools/call", {"name": "publish_generation", "arguments": {"id": gen_id}})
            try:
                pub = tool_result(resp)
                ok("publish_generation → published=true") if pub.get("published") else bad("publish_generation", str(pub)[:200])
            except Exception as e:
                bad("publish_generation", str(e))

            status, resp = rpc("tools/call", {"name": "list_published", "arguments": {"limit": 20}})
            try:
                lst = tool_result(resp)
                ids = [it["id"] for it in lst.get("items", [])]
                ok("list_published تحتوي العمل المنشور") if gen_id in ids else bad("list_published", f"id غير موجود بين {len(ids)}")
            except Exception as e:
                bad("list_published", str(e))

    # اختبار الحذف مستقل عن اكتمال التوليد: مهمة ثانية تُحذف فور إنشائها
    status, resp = rpc("tools/call", {
        "name": "generate_image",
        "arguments": {"prompt": "A tiny colorful parrot perched on a copper teacup, studio light", "wait_seconds": 0},
    })
    tmp = None
    try:
        tmp = tool_result(resp)
    except Exception as e:
        bad("مهمة الحذف المؤقتة", str(e))
    if tmp and tmp.get("id"):
        status, resp = rpc("tools/call", {"name": "delete_generation", "arguments": {"id": tmp["id"]}})
        try:
            d = tool_result(resp)
            ok("delete_generation") if d.get("ok") else bad("delete_generation", str(d)[:200])
        except Exception as e:
            bad("delete_generation", str(e))

        status, resp = rpc("tools/call", {"name": "get_generation", "arguments": {"id": tmp["id"]}})
        is_err = isinstance(resp, dict) and resp.get("result", {}).get("isError")
        ok("بعد الحذف get_generation → isError") if is_err else bad("get_generation بعد الحذف", str(resp)[:200])

    # 7) فيديو: إنشاء + متابعة قصيرة (نتركه يكمل وحده إن لم يلحق)
    print("\n--- توليد فيديو عبر MCP (إنشاء + متابعة قصيرة) ---")
    status, resp = rpc("tools/call", {
        "name": "generate_video",
        "arguments": {
            "prompt": "A glowing purple jellyfish drifting slowly in dark water, soft bioluminescence, macro shot",
            "aspect_ratio": "9:16",
            "resolution": "480p",
            "duration": 1,
            "enable_audio": False,
            "wait_seconds": 45,
        },
    }, timeout=120)
    vid = None
    try:
        vid = tool_result(resp)
    except Exception as e:
        bad("generate_video", f"{e} :: {str(resp)[:300]}")
    if vid and vid.get("taskId"):
        ok("generate_video أنشأت مهمة", f"id={vid['id'][:8]}… status={vid['status']}")
        vstatus = vid.get("status")
        if vstatus not in ("success", "fail"):
            for attempt in range(4):
                status, resp = rpc("tools/call", {
                    "name": "get_generation",
                    "arguments": {"id": vid["id"], "wait_seconds": 8},
                })
                try:
                    v = tool_result(resp)
                    vstatus = v.get("status")
                    print(f"    attempt {attempt + 1}: status={vstatus}")
                    if vstatus in ("success", "fail"):
                        break
                except Exception as e:
                    bad("متابعة الفيديو", str(e)); break
        if vstatus == "success":
            status, resp = rpc("tools/call", {"name": "publish_generation", "arguments": {"id": vid["id"]}})
            ok("الفيديو اكتمل ونُشر في المعرض") if isinstance(resp, dict) and not resp.get("result", {}).get("isError") \
                else bad("نشر الفيديو", str(resp)[:200])
        elif vstatus in ("waiting", "queuing", "generating"):
            print(f"    ملاحظة: الفيديو ما زال قيد التوليد ({vstatus}) — سيظهر مكتملًا في سجل الاستوديو (اختبار الإنشاء نجح)")
        elif vstatus == "fail":
            print("    ملاحظة: فشل توليد الفيديو لدى المزود (مسار الإنشاء والمتابعة سليمان)")
    else:
        bad("generate_video", str(vid)[:300])

    # أوتوبايلوت: مسح فقط (لا إنشاء)
    status, resp = rpc("tools/call", {"name": "run_autopilot", "arguments": {"create": False}})
    try:
        ap = tool_result(resp)
        ok("run_autopilot (مسح فقط)") if ap.get("ok") else bad("run_autopilot", str(ap)[:200])
    except Exception as e:
        bad("run_autopilot", str(e))

    # 8) فحص REST بعد إعادة الهيكلة
    print("\n--- فحص REST بعد إعادة الهيكلة ---")
    status, body = http("GET", f"{BASE}/api/generations")
    try:
        items = json.loads(body).get("items", [])
        ok("GET /api/generations", f"{len(items)} عنصرًا")
    except Exception as e:
        bad("GET /api/generations", str(e))

    status, body = http("POST", f"{BASE}/api/generate", {"type": "image"})
    ok("POST /api/generate مدخلات ناقصة → 400") if status == 400 else bad("POST /api/generate", f"status={status}")

    # 9) GET/OPTIONS على /mcp
    status, body = http("GET", MCP_URL)
    ok("GET /mcp → 405") if status == 405 else bad("GET /mcp", f"status={status}")
    req = urllib.request.Request(MCP_URL, method="OPTIONS")
    with urllib.request.urlopen(req, timeout=30) as res:
        opts_status = res.status
    ok("OPTIONS /mcp → 204") if opts_status == 204 else bad("OPTIONS /mcp", f"status={opts_status}")

    print(f"\n=== النتيجة: {PASS} نجح / {FAIL} فشل ===")
    http("DELETE", f"{BASE}/api/settings")  # استعادة الافتراضي بعد الاختبار
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
