# Vi — استوديو التوليد بالذكاء الاصطناعي 🎨🎬

تطبيق ويب لتوليد **الصور** و**الفيديو** من وصف نصي بالعربية، مبني على Next.js 16 مع حفظ كامل لسجل الأعمال في قاعدة بيانات **Turso (libSQL)** والتوليد عبر منصة **kie.ai**.

## المزايا

- 🖼️ توليد الصور بالنموذج `gpt-image-2-6/flare-text-to-image`
- 🎬 توليد الفيديو بالنموذج `grok-imagine-video-1-5-preview` (مع صوت تلقائي ومدة 1–15 ثانية)
- 🌓 واجهة عربية RTL بتصميم داكن أنيق، متوافقة مع الجوال والحاسوب
- 🗂️ سجل كامل لكل عمليات التوليد مع حالة مباشرة (انتظار → توليد → اكتمال)
- ⬇️ تحميل النتائج ونسخ الروابط وحذف العناصر من السجل
- 🗄️ قاعدة بيانات Turso تعمل محليًا وعلى Vercel دون أي إعداد إضافي (الجداول تُنشأ تلقائيًا)

## البنية التقنية

| الطبقة | التقنية |
| --- | --- |
| الواجهة | Next.js 16 (App Router) + TypeScript + Tailwind CSS 4 + shadcn/ui |
| قاعدة البيانات | Turso (libSQL) عبر `@libsql/client` |
| التوليد | kie.ai Jobs API (`createTask` / `recordInfo`) |
| النشر | Vercel |

## متغيرات البيئة

| المتغير | إلزامي | الوصف |
| --- | --- | --- |
| `TURSO_DATABASE_URL` | نعم | رابط قاعدة البيانات `libsql://...` |
| `TURSO_AUTH_TOKEN` | نعم | توكن قاعدة البيانات من لوحة Turso |
| `KIE_API_KEY` | نعم | مفتاح API من [kie.ai](https://kie.ai/api-key) |
| `KIE_IMAGE_MODEL` | لا | نموذج الصور (الافتراضي `gpt-image-2-6/flare-text-to-image`) |
| `KIE_VIDEO_MODEL` | لا | نموذج الفيديو (الافتراضي `grok-imagine-video-1-5-preview`) |

انسخ `.env.example` إلى `.env` واملأ القيم للتشغيل محليًا.

## التشغيل محليًا

```bash
bun install
bun run dev
```

ثم افتح `http://localhost:3000`.

## النشر على Vercel

1. ارفع الكود إلى مستودع GitHub (مستودع `Vi`).
2. من [vercel.com/new](https://vercel.com/new) اختر **Import** للمستودع.
3. في خطوة **Environment Variables** أضف المتغيرات الثلاثة الإلزامية:
   - `TURSO_DATABASE_URL`
   - `TURSO_AUTH_TOKEN`
   - `KIE_API_KEY`
4. اضغط **Deploy** — لا يحتاج المشروع أي إعداد آخر (Vercel يتعرّف على Next.js تلقائيًا).

## مسارات API

| المسار | الوصف |
| --- | --- |
| `POST /api/generate` | إنشاء مهمة توليد (صورة أو فيديو) |
| `GET /api/generations` | جلب آخر 60 عملية توليد |
| `GET /api/generations/[id]` | حالة عنصر معيّن (يُحدّث الحالة من kie.ai) |
| `DELETE /api/generations/[id]` | حذف عنصر من السجل |
| `GET /api` | فحص صحة الخدمة |

## ملاحظات

- التوليد غير متزامن: الواجهة تسأل الخادم كل 4 ثوانٍ عن حالة المهمة حتى الاكتمال.
- تكلفة كل عملية توليد تُخصم من رصيد حسابك في kie.ai حسب النموذج والدقة المختارة.
