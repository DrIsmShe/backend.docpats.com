// Стартовые разделы витрины DP-Tube.
//
// ЗАЧЕМ ИМЕННО ЭТИ СЕМЬ. Набор выведен из того, что платформа уже умеет
// снимать и разбирать: объяснения для пациента (основной вид роликов),
// разборы снимков (диагностическая арена), разборы анализов (станция
// «Анализы»), итоги приёма (машинная сборка из эпикриза), подготовка к
// процедурам (видео-согласия и плейлисты), анатомия и операции (студия
// DP-Videra) и визитки врачей с клиниками. Это не выдуманные рубрики, а
// имена тех потоков материала, которые в системе есть.
//
// ДАЛЬШЕ РАЗДЕЛЫ ЗАВОДИТ АДМИНИСТРАТОР — /admin/video-categories. Скрипт
// нужен один раз, чтобы витрина не открылась с единственной кнопкой «Все».
//
// ИДЕМПОТЕНТНО: повторный запуск ничего не дублирует и не переставляет
// раздел ролику, которому его уже назначили руками.
//
// ЗАПУСК: node seedCategories2.mjs   (из каталога server)

import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const РАЗДЕЛЫ = [
  {
    slug: "explainer",
    kind: "explainer",
    order: 10,
    title: {
      ru: "Объяснения для пациентов",
      en: "Patient explanations",
      az: "Pasiyentlər üçün izahlar",
      tr: "Hastalar için açıklamalar",
      ar: "شروحات للمرضى",
    },
  },
  {
    slug: "scan-reviews",
    kind: "radiology_review",
    order: 20,
    title: {
      ru: "Разборы снимков",
      en: "Scan reviews",
      az: "Şəkil təhlilləri",
      tr: "Görüntü incelemeleri",
      ar: "تحليل الصور",
    },
  },
  {
    slug: "lab-reviews",
    kind: null,
    order: 30,
    title: {
      ru: "Разборы анализов",
      en: "Lab result reviews",
      az: "Analiz təhlilləri",
      tr: "Tahlil incelemeleri",
      ar: "تحليل الفحوصات",
    },
  },
  {
    slug: "visit-summary",
    kind: "consult_summary",
    order: 40,
    title: {
      ru: "Итоги приёма",
      en: "Visit summaries",
      az: "Qəbulun yekunu",
      tr: "Muayene özeti",
      ar: "خلاصة الزيارة",
    },
  },
  {
    slug: "preparation",
    kind: null,
    order: 50,
    title: {
      ru: "Подготовка к процедурам",
      en: "Preparing for procedures",
      az: "Prosedurlara hazırlıq",
      tr: "İşlemlere hazırlık",
      ar: "التحضير للإجراءات",
    },
  },
  {
    slug: "anatomy-surgery",
    kind: null,
    order: 60,
    title: {
      ru: "Анатомия и операции",
      en: "Anatomy and surgery",
      az: "Anatomiya və əməliyyatlar",
      tr: "Anatomi ve ameliyatlar",
      ar: "التشريح والعمليات",
    },
  },
  {
    slug: "doctors-clinics",
    kind: "promo",
    order: 70,
    title: {
      ru: "Врачи и клиники",
      en: "Doctors and clinics",
      az: "Həkimlər və klinikalar",
      tr: "Hekimler ve klinikler",
      ar: "أطباء وعيادات",
    },
  },
];

async function main() {
  await mongoose.connect(process.env.MONGO_URL, {
    dbName: process.env.MONGODB_DB || undefined,
  });
  console.log(`база подключена: ${mongoose.connection.name}`);

  const { default: VideoCategory } = await import(
    "./modules/video/models/videoCategory.model.js"
  );
  const { default: Video } = await import("./modules/video/models/video.model.js");

  for (const р of РАЗДЕЛЫ) {
    let раздел = await VideoCategory.findOne({ slug: р.slug });
    if (раздел) {
      console.log(`— ${р.title.ru}: уже есть`);
    } else {
      раздел = await VideoCategory.create({
        slug: р.slug,
        title: р.title,
        order: р.order,
        active: true,
      });
      console.log(`+ ${р.title.ru} (${р.slug})`);
    }

    // Раскладываем по полкам только те ролики, которым раздел ещё не
    // назначали, и только там, где соответствие вида однозначно. Полки
    // вроде «Подготовка к процедурам» наполняет человек: машине не понять
    // из вида ролика, что он именно про подготовку.
    if (!р.kind) continue;
    const { modifiedCount } = await Video.updateMany(
      { kind: р.kind, categoryId: null },
      { $set: { categoryId: раздел._id } },
    );
    if (modifiedCount) console.log(`  роликов на полку: ${modifiedCount}`);
  }

  const всего = await VideoCategory.countDocuments({ active: true });
  console.log(`готово. активных разделов: ${всего}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("ОШИБКА:", err.message);
  process.exit(1);
});
