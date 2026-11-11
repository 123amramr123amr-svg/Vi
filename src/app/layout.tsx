import type { Metadata, Viewport } from "next";
import { Cairo } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const cairo = Cairo({
  subsets: ["arabic", "latin"],
  variable: "--font-cairo",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Vi — استوديو التوليد بالذكاء الاصطناعي",
  description:
    "أنشئ صورًا وفيديوهات مذهلة بالذكاء الاصطناعي من وصف نصي، مع حفظ سجل أعمالك في قاعدة بيانات Turso.",
  icons: { icon: "/vi-logo.svg" },
  openGraph: {
    title: "Vi — استوديو التوليد بالذكاء الاصطناعي",
    description: "توليد الصور والفيديو بالذكاء الاصطناعي من وصف نصي",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#12081f",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" className="dark" suppressHydrationWarning>
      <body
        className={`${cairo.variable} font-sans antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
