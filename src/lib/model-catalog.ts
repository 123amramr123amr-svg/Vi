/**
 * كتالوج احتياطي بمعرّفات نماذج معروفة ومُجرّبة لدى kie.ai —
 * يُعرض فقط إذا لم يدعم المزوّد جلب القائمة تلقائيًا عبر /models.
 * (المعرّفات هنا مؤكدة من الاستخدام الفعلي للمشروع؛ أي معرّف آخر
 * يمكن كتابته يدويًا في تبويب الإعدادات.)
 */

export interface CatalogEntry {
  id: string;
  kind: "image" | "video";
  label: string;
}

export const KIE_MODEL_CATALOG: CatalogEntry[] = [
  {
    id: "gpt-image-2-6/flare-text-to-image",
    kind: "image",
    label: "GPT Image 2.6 — توليد صور نصي (الافتراضي)",
  },
  {
    id: "grok-imagine-video-1-5-preview",
    kind: "video",
    label: "Grok Imagine Video 1.5 Preview — فيديو حتى 15 ثانية (الافتراضي)",
  },
  {
    id: "grok-imagine/extend",
    kind: "video",
    label: "Grok Imagine — تكملة تلقائية لفيديو سابق (Video Extend)",
  },
];
