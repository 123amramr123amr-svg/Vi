/**
 * أوتوبايلوت النشر التلقائي.
 * يختار مواضيع من قائمة جاهزة (أو من متغير البيئة AUTOPILOT_TOPICS)
 * بالدوران، وينشئ فيديو عموديًا بنمط السوشيال ميديا، ثم يُنشر تلقائيًا
 * في المعرض العام عند اكتماله (عبر خطوة مسح لاحقة).
 */

export interface AutopilotTaskPlan {
  type: "image" | "video";
  prompt: string;
  params: {
    aspectRatio: string;
    resolution: string;
    duration?: number;
    enableAudio?: boolean;
    autopilot: true;
  };
}

/** قائمة المواضيع الافتراضية — أوصاف فيديو إنجليزية غنية (نتائج أفضل) */
const DEFAULT_TOPICS: string[] = [
  "Cinematic slow drone shot flying over a futuristic neon city at night, rain reflections, purple and fuchsia lights, cyberpunk mood, smooth camera movement",
  "A cozy coffee shop scene in the morning, steam rising from a latte, warm sunlight through the window, shallow depth of field, calm atmosphere",
  "Waves crashing on a tropical beach at golden hour, slow motion, drone view pulling back, warm cinematic color grading",
  "An astronaut floating peacefully in space watching a glowing purple nebula, cinematic lighting, slow rotation, stars twinkling",
  "A majestic eagle soaring over misty mountain peaks at sunrise, epic cinematic drone shot, volumetric light rays",
  "Abstract flowing liquid ink in water forming a blooming flower, purple and pink gradient colors, macro shot, mesmerizing motion",
  "Time-lapse of a busy city street turning from day to night, neon signs lighting up, energetic urban vibe",
  "A cute robot watering a small glowing plant inside a high-tech greenhouse, soft rim lighting, heartwarming sci-fi mood",
  "Fireflies dancing over a calm forest lake at twilight, dreamy atmosphere, soft bokeh, magical realism",
  "Retro synthwave car driving into a sunset with a grid horizon, chrome reflections, 80s aesthetic, smooth dolly shot",
  "Snow falling gently on a quiet wooden cabin in a pine forest at night, warm light from windows, peaceful winter scene",
  "Underwater scene of a sea turtle swimming over a colorful coral reef, sun rays piercing the water, tranquil cinematic motion",
];

/** مواضيع مخصصة من متغير البيئة (مفصولة بـ |) */
export function getTopics(): string[] {
  const raw = process.env.AUTOPILOT_TOPICS?.trim();
  if (!raw) return DEFAULT_TOPICS;
  const topics = raw
    .split("|")
    .map((t) => t.trim())
    .filter(Boolean);
  return topics.length > 0 ? topics : DEFAULT_TOPICS;
}

/** اختيار الموضوع التالي بالدوران حسب عدد المهام السابقة */
export function pickTopic(count: number): string {
  const topics = getTopics();
  return topics[((count % topics.length) + topics.length) % topics.length]!;
}

/** بناء خطة مهمة أوتوبايلوت (فيديو عمودي افتراضيًا بنمط السوشيال ميديا) */
export function buildAutopilotPlan(options: {
  type?: "image" | "video";
  prompt?: string;
  topicIndex: number;
}): AutopilotTaskPlan {
  const type = options.type === "image" ? "image" : "video";
  const prompt =
    options.prompt?.trim() || pickTopic(options.topicIndex);

  if (type === "image") {
    return {
      type,
      prompt,
      params: { aspectRatio: "9:16", resolution: "1K", autopilot: true },
    };
  }
  return {
    type,
    prompt,
    params: {
      aspectRatio: "9:16",
      resolution: "720p",
      duration: 8,
      enableAudio: true,
      autopilot: true,
    },
  };
}
