/** الأنواع المشتركة بين الواجهة والخادم */

export type GenerationType = "image" | "video";

export type GenerationStatus =
  | "pending"
  | "waiting"
  | "queuing"
  | "generating"
  | "success"
  | "fail";

export interface GenerationParams {
  aspectRatio?: string;
  resolution?: string;
  duration?: number;
  enableAudio?: boolean;
}

export interface Generation {
  id: string;
  taskId: string | null;
  type: GenerationType;
  model: string;
  prompt: string;
  params: GenerationParams;
  status: GenerationStatus;
  resultUrls: string[];
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

const ACTIVE: readonly GenerationStatus[] = [
  "pending",
  "waiting",
  "queuing",
  "generating",
];

export function isActiveStatus(status: GenerationStatus): boolean {
  return ACTIVE.includes(status);
}

export const IMAGE_ASPECT_RATIOS = [
  "auto",
  "1:1",
  "3:2",
  "2:3",
  "4:3",
  "3:4",
  "5:4",
  "4:5",
  "16:9",
  "9:16",
  "2:1",
  "1:2",
  "21:9",
  "9:21",
  "3:1",
  "1:3",
] as const;

export const VIDEO_ASPECT_RATIOS = [
  "auto",
  "1:1",
  "16:9",
  "9:16",
  "3:2",
  "2:3",
] as const;

export const IMAGE_RESOLUTIONS = ["1K", "2K", "4K"] as const;
export const VIDEO_RESOLUTIONS = ["480p", "720p", "1080p"] as const;
