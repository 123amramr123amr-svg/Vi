import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  /* حزمة ffmpeg الثنائية تُترك خارج الحِزم وتُضمَّن كملف لخدمة دمج الفيديوهات */
  serverExternalPackages: ["ffmpeg-static"],
  outputFileTracingIncludes: {
    "/api/merge": ["./node_modules/ffmpeg-static/**"],
    "/api/merge/[id]": ["./node_modules/ffmpeg-static/**"],
    "/api/merge/[id]/file": ["./node_modules/ffmpeg-static/**"],
  },
};

export default nextConfig;
