#!/bin/bash
# اختبار واجهة تبويب الإعدادات كاملًا (بدون أي توليد حقيقي)
cd /home/z/my-project

setsid nohup bun run dev >> dev.log 2>&1 < /dev/null &
setsid nohup node /tmp/mock-provider.mjs > /tmp/mock.log 2>&1 < /dev/null &
for i in $(seq 1 40); do
  code=$(curl -s -m 2 -o /dev/null -w "%{http_code}" http://localhost:3000/api/settings 2>/dev/null)
  [ "$code" = "200" ] && { echo "== servers UP (${i}s)"; break; }
  sleep 1
done

agent-browser close >/dev/null 2>&1 || true
agent-browser open http://localhost:3000 || exit 1
agent-browser wait --load networkidle || true

echo "=== open settings tab ==="
agent-browser find role tab click --name "الإعدادات" || agent-browser find text "الإعدادات" click
sleep 1

echo "=== snapshot settings panel ==="
agent-browser snapshot -i -c | head -50

echo "=== fill base url ==="
agent-browser find label "رابط الخدمة (Base URL)" fill "http://localhost:4123" || agent-browser eval "document.getElementById('provider-base-url').value='http://localhost:4123'; document.getElementById('provider-base-url').dispatchEvent(new Event('input',{bubbles:true}))"

echo "=== fill api key ==="
agent-browser find label "مفتاح API" fill "test-key-12345678" || agent-browser eval "const el=document.getElementById('provider-api-key'); el.value='test-key-12345678'; el.dispatchEvent(new Event('input',{bubbles:true}))"

echo "=== click fetch models ==="
agent-browser find role button click --name "جلب النماذج المرتبطة بالمفتاح"
sleep 3
agent-browser snapshot -i -c | head -60
agent-browser screenshot /tmp/render/settings-fetched.png || true

echo "=== pick veo3 as video model ==="
agent-browser find role option click --name "google/veo3" || true
sleep 1

echo "=== save ==="
agent-browser find role button click --name "حفظ الإعدادات"
sleep 2
agent-browser screenshot /tmp/render/settings-saved.png || true

echo "=== verify via API ==="
curl -s http://localhost:3000/api/settings

echo
echo "=== console errors ==="
agent-browser errors || true
agent-browser close || true
