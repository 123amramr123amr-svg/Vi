import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "سياسة الخصوصية — Vi AI Studio",
  description: "سياسة خصوصية تطبيق Vi AI Studio",
};

export default function PrivacyPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <h1 className="text-2xl font-extrabold">سياسة الخصوصية</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          آخر تحديث: نوفمبر 2025
        </p>

        <div className="mt-8 space-y-6 text-sm leading-7">
          <section>
            <h2 className="text-lg font-bold">ماذا يخزّن هذا التطبيق؟</h2>
            <p>
              تطبيق Vi AI Studio يخزّن في قاعدة بيانات خاصة بمالك التطبيق
              (Turso) المعلومات اللازمة لعمل الخدمة فقط: وصف المحتوى الذي
              تطلبه، خيارات التوليد (الأبعاد، الدقة، المدة)، حالة المهمة،
              روابط النتائج المولّدة، ورسائل المحادثة مع المساعد الذكي.
              لا يحتوي التطبيق على حسابات مستخدمين ولا يجمع بيانات تعريف
              شخصية مثل الاسم أو البريد الإلكتروني أو أرقام الهواتف.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold">مشاركة البيانات مع أطراف ثالثة</h2>
            <p>
              لإتمام عملية التوليد يتم إرسال وصف المحتوى إلى مزوّد الذكاء
              الاصطناعي kie.ai (وبالتحديد إلى النماذج المستخدمة لتوليد
              الصور والفيديو). في حال استخدام مفتاح OpenAI الخاص بك
              للمحادثة، تُرسل رسائل المحادثة إلى OpenAI مباشرة. لا يشارك
              هذا التطبيق بياناتك مع أي جهة أخرى ولا يستخدمها في إعلانات
              أو تدريب نماذج.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold">التحكم في بياناتك</h2>
            <p>
              يمكنك حذف أي عملية توليد من داخل التطبيق في أي وقت (زر
              الحذف في السجل)، أو مسح سجل المحادثة بالكامل من لوحة
              المحادثة. عند حذف عنصر يُزال صفه من قاعدة البيانات نهائيًا.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold">روابط النتائج</h2>
            <p>
              روابط الملفات المولّدة (الصور والفيديو) تُستضاف لدى مزوّد
              kie.ai وتكون متاحة عبر روابط مباشرة. لا يتم إدراج هذه
              الروابط في أي فهرس عام من طرف هذا التطبيق.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold">التواصل</h2>
            <p>
              لأي استفسار متعلق بالخصوصية يمكنك التواصل مع مالك التطبيق
              عبر مستودع المشروع على GitHub:{" "}
              <a
                href="https://github.com/123amramr123amr-svg/Vi"
                target="_blank"
                rel="noreferrer"
                className="text-fuchsia-300 underline"
              >
                github.com/123amramr123amr-svg/Vi
              </a>
            </p>
          </section>
        </div>

        <div className="mt-10">
          <Link
            href="/"
            className="text-sm font-bold text-fuchsia-300 underline"
          >
            ← العودة إلى الاستوديو
          </Link>
        </div>
      </main>
    </div>
  );
}
