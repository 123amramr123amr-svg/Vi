/**
 * ثوابت النماذج الافتراضية.
 *
 * منطق الاتصال بالمزوّد انتقل إلى src/lib/provider.ts — يدعم أي رابط
 * لأي مفتاح: واجهة المهام الموحدة (نمط kie.ai) والواجهة المتوافقة مع
 * OpenAI (images/generations و videos)، مع مرشّحات روابط تُشتق تلقائيًا.
 * الرابط والمفتاح والنماذج تُدار من تبويب الإعدادات (src/lib/settings.ts)
 * مع الرجوع إلى متغيرات البيئة عند غياب القيم المحفوظة.
 */

/** الرابط الافتراضي لخدمة التوليد (نمط kie.ai) */
export const DEFAULT_BASE_URL = "https://api.kie.ai";

/** نموذج توليد الصور (يمكن تغييره عبر متغير البيئة KIE_IMAGE_MODEL أو من الإعدادات) */
export const IMAGE_MODEL =
  process.env.KIE_IMAGE_MODEL ?? "gpt-image-2-6/flare-text-to-image";

/** نموذج توليد الفيديو (يمكن تغييره عبر متغير البيئة KIE_VIDEO_MODEL أو من الإعدادات) */
export const VIDEO_MODEL =
  process.env.KIE_VIDEO_MODEL ?? "grok-imagine-video-1-5-preview";
