// server/common/templates/trialReminderEmails.js
// ─────────────────────────────────────────────────────────────────────
//   Шаблоны email-напоминаний об окончании trial-периода для врачей.
//
//   3 типа писем (за 30 / 7 / 1 день до окончания trial)
//   × 5 языков (ru/en/tr/az/ar)
//   = 15 текстов.
//
//   Используется в jobs/checkTrialReminders.js (cron-задача).
//
//   Использование:
//     const { subject, body } = getTrialReminderEmail({
//       lang: "ru",
//       type: "30d",
//       firstName: "Исмаил",
//       trialEndsDate: "31.10.2026"
//     });
// ─────────────────────────────────────────────────────────────────────

const TEMPLATES = {
  ru: {
    "30d": {
      subject: "DocPats: ваш бесплатный период заканчивается через 30 дней",
      body: ({
        firstName,
        trialEndsDate,
      }) => `Здравствуйте, ${firstName || "доктор"}!

Ваш 6-месячный бесплатный период на DocPats заканчивается ${trialEndsDate}.

После этой даты ваш аккаунт автоматически перейдёт на тариф Doctor Basic ($3.50/мес — около 6 AZN). Если хотите сохранить полный набор функций уровня Doctor Super, выберите подходящий план заранее.

Посмотреть тарифы и выбрать план:
https://docpats.com/pricing

Что произойдёт ${trialEndsDate}:
- Если у вас не будет активной подписки — переход на Doctor Basic
- Все ваши данные, пациенты и история — сохранятся
- AI-функции продолжат работать, но с лимитами Basic

Если у вас есть вопросы — ответьте на это письмо.

С уважением,
команда DocPats`,
    },
    "7d": {
      subject: "DocPats: остаётся 7 дней бесплатного периода",
      body: ({
        firstName,
        trialEndsDate,
      }) => `Здравствуйте, ${firstName || "доктор"}!

Ваш бесплатный период на DocPats заканчивается через неделю — ${trialEndsDate}.

Чтобы не потерять полный доступ к AI-функциям и сохранить рабочий процесс — выберите подходящий план:
https://docpats.com/pricing

После окончания trial:
- Аккаунт автоматически переходит на Doctor Basic ($3.50/мес)
- Лимиты снизятся до 7 AI-анализов и 3 AI-статей в месяц
- Видео-приёмы будут ограничены 30 минутами в месяц

Если эти лимиты вам не подходят — рассмотрите Doctor Super ($13/мес) или Doctor Pro ($29/мес).

С уважением,
команда DocPats`,
    },
    "1d": {
      subject: "DocPats: бесплатный период заканчивается завтра",
      body: ({
        firstName,
        trialEndsDate,
      }) => `Здравствуйте, ${firstName || "доктор"}!

Ваш бесплатный период на DocPats заканчивается завтра — ${trialEndsDate}.

Если вы ещё не выбрали план — самое время это сделать:
https://docpats.com/pricing

Что произойдёт завтра в 00:00:
- Аккаунт перейдёт на Doctor Basic ($3.50/мес)
- AI-лимиты снизятся
- Все данные сохранятся, ничего не потеряется

С уважением,
команда DocPats`,
    },
  },

  en: {
    "30d": {
      subject: "DocPats: your free trial ends in 30 days",
      body: ({ firstName, trialEndsDate }) => `Hello, ${firstName || "Doctor"}!

Your 6-month free trial on DocPats ends on ${trialEndsDate}.

After that date, your account will automatically switch to Doctor Basic ($3.50/mo). If you'd like to keep the full Doctor Super feature set, please choose a plan in advance.

View pricing and choose a plan:
https://docpats.com/pricing

What happens on ${trialEndsDate}:
- If you don't have an active subscription — your plan switches to Doctor Basic
- All your data, patients, and history will be preserved
- AI features keep working, but with Basic-level limits

If you have any questions, just reply to this email.

Best regards,
the DocPats team`,
    },
    "7d": {
      subject: "DocPats: 7 days left in your free trial",
      body: ({ firstName, trialEndsDate }) => `Hello, ${firstName || "Doctor"}!

Your free trial on DocPats ends in a week — on ${trialEndsDate}.

To keep full access to AI features and continue your workflow without interruption, please choose a plan:
https://docpats.com/pricing

After the trial:
- Your account switches to Doctor Basic ($3.50/mo)
- Limits drop to 7 AI analyses and 3 AI articles per month
- Video appointments limited to 30 minutes per month

If these limits don't fit your practice, consider Doctor Super ($13/mo) or Doctor Pro ($29/mo).

Best regards,
the DocPats team`,
    },
    "1d": {
      subject: "DocPats: free trial ends tomorrow",
      body: ({ firstName, trialEndsDate }) => `Hello, ${firstName || "Doctor"}!

Your free trial on DocPats ends tomorrow — ${trialEndsDate}.

If you haven't chosen a plan yet, now is the time:
https://docpats.com/pricing

What happens tomorrow at 00:00:
- Your account switches to Doctor Basic ($3.50/mo)
- AI limits will be reduced
- All data is preserved, nothing is lost

Best regards,
the DocPats team`,
    },
  },

  tr: {
    "30d": {
      subject: "DocPats: ücretsiz deneme süreniz 30 gün içinde sona eriyor",
      body: ({ firstName, trialEndsDate }) => `Merhaba ${firstName || "Doktor"}!

DocPats üzerindeki 6 aylık ücretsiz deneme süreniz ${trialEndsDate} tarihinde sona eriyor.

Bu tarihten sonra hesabınız otomatik olarak Doctor Basic'e ($3.50/ay) geçecektir. Doctor Super seviyesindeki tüm özellikleri korumak istiyorsanız, önceden bir plan seçmenizi öneririz.

Tarifeleri görüntüle:
https://docpats.com/pricing

${trialEndsDate} tarihinde ne olacak:
- Aktif aboneliğiniz yoksa — plan Doctor Basic'e geçer
- Tüm verileriniz, hastalarınız ve geçmişiniz korunur
- AI özellikleri Basic limitleriyle çalışmaya devam eder

Sorularınız varsa bu e-postaya yanıt verin.

Saygılarımızla,
DocPats ekibi`,
    },
    "7d": {
      subject: "DocPats: ücretsiz dönemde 7 gün kaldı",
      body: ({ firstName, trialEndsDate }) => `Merhaba ${firstName || "Doktor"}!

DocPats üzerindeki ücretsiz deneme süreniz bir hafta içinde — ${trialEndsDate} tarihinde — sona eriyor.

AI özelliklerine tam erişimi korumak ve iş akışınızı kesintisiz sürdürmek için bir plan seçin:
https://docpats.com/pricing

Deneme süresinden sonra:
- Hesap Doctor Basic'e ($3.50/ay) geçer
- Limitler ayda 7 AI analizi ve 3 AI makalesine düşer
- Video randevular ayda 30 dakika ile sınırlanır

Bu limitler size uygun değilse Doctor Super ($13/ay) veya Doctor Pro ($29/ay) seçeneklerini değerlendirin.

Saygılarımızla,
DocPats ekibi`,
    },
    "1d": {
      subject: "DocPats: ücretsiz dönem yarın sona eriyor",
      body: ({ firstName, trialEndsDate }) => `Merhaba ${firstName || "Doktor"}!

DocPats üzerindeki ücretsiz deneme süreniz yarın — ${trialEndsDate} tarihinde — sona eriyor.

Henüz bir plan seçmediyseniz şimdi tam zamanı:
https://docpats.com/pricing

Yarın 00:00'da ne olacak:
- Hesap Doctor Basic'e ($3.50/ay) geçer
- AI limitleri düşer
- Tüm veriler korunur, hiçbir şey kaybolmaz

Saygılarımızla,
DocPats ekibi`,
    },
  },

  az: {
    "30d": {
      subject: "DocPats: pulsuz sınaq dövrünüz 30 gün sonra başa çatır",
      body: ({ firstName, trialEndsDate }) => `Salam, ${firstName || "doktor"}!

DocPats-da 6 aylıq pulsuz sınaq dövrünüz ${trialEndsDate} tarixində başa çatır.

Bu tarixdən sonra hesabınız avtomatik olaraq Doctor Basic-ə ($3.50/ay) keçəcək. Doctor Super səviyyəsindəki bütün funksiyaları saxlamaq istəyirsinizsə, əvvəlcədən plan seçməyinizi tövsiyə edirik.

Tarifləri gör:
https://docpats.com/pricing

${trialEndsDate} tarixində nə olacaq:
- Aktiv abunəliyiniz yoxdursa — plan Doctor Basic-ə keçir
- Bütün məlumatlarınız, xəstələriniz və tarixçəniz qorunur
- AI funksiyaları Basic limitləri ilə işləməyə davam edir

Suallarınız varsa, bu məktuba cavab verin.

Hörmətlə,
DocPats komandası`,
    },
    "7d": {
      subject: "DocPats: pulsuz dövrdə 7 gün qalıb",
      body: ({ firstName, trialEndsDate }) => `Salam, ${firstName || "doktor"}!

DocPats-da pulsuz sınaq dövrünüz bir həftə sonra — ${trialEndsDate} tarixində — başa çatır.

AI funksiyalarına tam çıxışı qorumaq və iş axınınızı fasiləsiz davam etdirmək üçün plan seçin:
https://docpats.com/pricing

Sınaq dövrü bitdikdən sonra:
- Hesab Doctor Basic-ə ($3.50/ay) keçir
- Limitlər ayda 7 AI analizi və 3 AI məqaləsinə düşür
- Video qəbullar ayda 30 dəqiqə ilə məhdudlaşır

Bu limitlər sizə uyğun deyilsə, Doctor Super ($13/ay) və ya Doctor Pro ($29/ay) variantlarına baxın.

Hörmətlə,
DocPats komandası`,
    },
    "1d": {
      subject: "DocPats: pulsuz dövr sabah başa çatır",
      body: ({ firstName, trialEndsDate }) => `Salam, ${firstName || "doktor"}!

DocPats-da pulsuz sınaq dövrünüz sabah — ${trialEndsDate} tarixində — başa çatır.

Hələ plan seçməmisinizsə, indi bunun tam vaxtıdır:
https://docpats.com/pricing

Sabah saat 00:00-da nə olacaq:
- Hesab Doctor Basic-ə ($3.50/ay) keçir
- AI limitləri azalır
- Bütün məlumatlar qorunur, heç nə itmir

Hörmətlə,
DocPats komandası`,
    },
  },

  ar: {
    "30d": {
      subject: "DocPats: تنتهي فترة التجربة المجانية الخاصة بك خلال 30 يوماً",
      body: ({ firstName, trialEndsDate }) => `مرحباً ${firstName || "دكتور"}!

تنتهي فترة التجربة المجانية لمدة 6 أشهر على DocPats في ${trialEndsDate}.

بعد هذا التاريخ، سيتم تحويل حسابك تلقائياً إلى خطة Doctor Basic ($3.50/شهر). إذا كنت ترغب في الاحتفاظ بكامل ميزات Doctor Super، يرجى اختيار خطة مسبقاً.

عرض الأسعار:
https://docpats.com/pricing

ماذا سيحدث في ${trialEndsDate}:
- إذا لم يكن لديك اشتراك نشط — يتم التحويل إلى Doctor Basic
- جميع بياناتك ومرضاك وسجلك ستُحفظ
- ميزات AI ستستمر في العمل مع حدود Basic

إذا كانت لديك أي أسئلة، يرجى الرد على هذا البريد.

مع التحية،
فريق DocPats`,
    },
    "7d": {
      subject: "DocPats: 7 أيام متبقية في الفترة المجانية",
      body: ({ firstName, trialEndsDate }) => `مرحباً ${firstName || "دكتور"}!

تنتهي فترة التجربة المجانية على DocPats خلال أسبوع — في ${trialEndsDate}.

للاحتفاظ بالوصول الكامل إلى ميزات AI والاستمرار في عملك دون انقطاع، يرجى اختيار خطة:
https://docpats.com/pricing

بعد انتهاء التجربة:
- يتم تحويل الحساب إلى Doctor Basic ($3.50/شهر)
- تنخفض الحدود إلى 7 تحليلات AI و 3 مقالات AI شهرياً
- مواعيد الفيديو محدودة بـ 30 دقيقة شهرياً

إذا كانت هذه الحدود لا تناسب ممارستك، فكر في Doctor Super ($13/شهر) أو Doctor Pro ($29/شهر).

مع التحية،
فريق DocPats`,
    },
    "1d": {
      subject: "DocPats: تنتهي الفترة المجانية غداً",
      body: ({ firstName, trialEndsDate }) => `مرحباً ${firstName || "دكتور"}!

تنتهي فترة التجربة المجانية على DocPats غداً — في ${trialEndsDate}.

إذا لم تختر خطة بعد، فهذا هو الوقت المناسب:
https://docpats.com/pricing

ما سيحدث غداً في 00:00:
- يتم تحويل الحساب إلى Doctor Basic ($3.50/شهر)
- ستنخفض حدود AI
- جميع البيانات محفوظة، لن يضيع شيء

مع التحية،
فريق DocPats`,
    },
  },
};

/**
 * Получить готовый email (subject + body) для отправки.
 * @param {Object} opts
 * @param {String} opts.lang   — "ru" | "en" | "tr" | "az" | "ar"
 * @param {String} opts.type   — "30d" | "7d" | "1d"
 * @param {String} opts.firstName    — имя врача (если есть)
 * @param {String} opts.trialEndsDate — дата окончания trial в формате DD.MM.YYYY
 * @returns {{subject: String, body: String}}
 */
export function getTrialReminderEmail({
  lang = "ru",
  type = "30d",
  firstName,
  trialEndsDate,
}) {
  // Fallback на русский если язык не поддерживается
  const localeData = TEMPLATES[lang] || TEMPLATES.ru;
  const template = localeData[type] || localeData["30d"];

  return {
    subject: template.subject,
    body: template.body({ firstName, trialEndsDate }),
  };
}
