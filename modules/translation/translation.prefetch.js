// server/modules/translation/translation.prefetch.js
//
// Догоняющий перевод опубликованных материалов на все языки платформы.
//
// Зачем переписано
// ─────────────────────────────────────────────────────────────────────
// Прежняя версия брала ТОП-10 по просмотрам на каждый тип и переводила
// только их. Отсюда лента, наполовину переведённая: популярные карточки
// пользователь видел на своём языке, остальные — на языке оригинала, вперемешку
// в одной сетке. Выглядело это как случайный сбой перевода, хотя работало
// ровно как написано.
//
// Причём догнать этот хвост было нечем: список ленты зовёт
// getTranslationIfExists (перевода нет → отдаём оригинал и НИЧЕГО не
// планируем), а getOrCreateTranslation с постановкой в очередь есть только на
// странице отдельного материала. Материал, на который никто не заходил
// поштучно и который не попал в десятку по просмотрам, не переводился никогда.
//
// Теперь берётся весь опубликованный корпус, а ограничивается не выборка,
// а ТЕМП: за один запуск планируется не больше BATCH недостающих переводов.
// Крон ходит каждые 10 минут (jobs/prefetch.job.js), очередь дедуплицирует
// задачи по jobId и отказывается принимать новые при переполнении
// (translation.service.js) — значит догон сходится сам и не может залить
// очередь разом.

import Article from "../../common/models/Articles/articles.js";
import ArticleScine from "../../common/models/Articles/articles-scince.js";
import ContentTranslation from "../../common/models/Articles/contentTranslation.js";
import { enqueueTranslation } from "./translation.service.js";

const LANGUAGES = ["en", "ru", "az", "tr", "ar"];

// Сколько недостающих переводов планируем за один проход крона.
//
// Потолок здесь, а не в размере выборки: выборка обязана видеть весь корпус,
// иначе материал, не попавший в неё, не переведётся никогда — это и была
// ошибка прежней версии. Ограничивать надо скорость, а не охват.
const BATCH = Number(process.env.TRANSLATION_PREFETCH_BATCH || 40);

const MODELS = [
  { model: Article, entityType: "Article" },
  { model: ArticleScine, entityType: "ArticleScine" },
];

/**
 * Пары «материал + язык», перевода на который нет.
 *
 * Существующие переводы забираются ОДНИМ запросом на тип, а не запросом на
 * каждую пару: у прежней версии было N×5 последовательных обращений к базе,
 * и на полном корпусе это стало бы самой дорогой частью работы.
 *
 * Живым считается тот же перевод, что отдаётся посетителю
 * (translation.repository.js, findTranslation): не устаревший и сделанный с
 * текущей редакции. Перевод с прошлой версии текста не в счёт — его всё равно
 * не покажут.
 */
async function missingPairs({ model, entityType }) {
  const entities = await model
    .find({ isPublished: true })
    // Полный текст здесь не нужен и стоил бы памяти на всём корпусе:
    // подтянем его только для тех, кого действительно ставим в очередь.
    .select({ _id: 1, originalLanguage: 1, translationVersion: 1, createdAt: 1 })
    .sort({ createdAt: -1 })
    .lean();

  if (!entities.length) return [];

  const rows = await ContentTranslation.find(
    {
      entityType,
      entityId: { $in: entities.map((e) => e._id) },
      isStale: false,
    },
    { entityId: 1, language: 1, sourceVersion: 1 },
  ).lean();

  const have = new Set();
  for (const r of rows) {
    have.add(`${r.entityId}:${r.language}:${r.sourceVersion ?? 0}`);
  }

  const pairs = [];
  for (const e of entities) {
    const version = e.translationVersion || 0;
    for (const lang of LANGUAGES) {
      // На язык оригинала переводить нечего.
      if (lang === e.originalLanguage) continue;
      if (have.has(`${e._id}:${lang}:${version}`)) continue;
      pairs.push({ entityId: e._id, entityType, model, targetLanguage: lang });
    }
  }
  return pairs;
}

/**
 * Что берём в работу за этот проход.
 *
 * Половина партии — самые свежие материалы: новое должно становиться
 * переведённым быстро, а не ждать своей очереди за архивом.
 *
 * Вторая половина — случайная выборка из остальных, и это не украшение.
 * Список недостающих переводов пересобирается каждый запуск заново, поэтому
 * при выборе строго «первые N» материал, который почему-то не переводится
 * (воркер падает на нём, текст битый, язык не поддержан), занимает голову
 * партии в КАЖДОМ проходе и вечно отталкивает хвост. Очередь дедуплицирует
 * такие задачи по jobId, так что вреда от повтора нет, — но и прогресса нет
 * тоже. Случайная половина гарантирует, что до любого материала дойдёт
 * очередь независимо от того, что происходит с остальными.
 */
function pickBatch(pairs) {
  if (pairs.length <= BATCH) return pairs;

  const freshCount = Math.ceil(BATCH / 2);
  const fresh = pairs.slice(0, freshCount);

  const rest = pairs.slice(freshCount);
  const sampled = [];
  const taken = new Set();
  const need = Math.min(BATCH - freshCount, rest.length);
  while (sampled.length < need) {
    const i = Math.floor(Math.random() * rest.length);
    if (taken.has(i)) continue;
    taken.add(i);
    sampled.push(rest[i]);
  }

  return [...fresh, ...sampled];
}

export const prefetchTranslations = async () => {
  try {
    const all = [];
    for (const spec of MODELS) {
      all.push(...(await missingPairs(spec)));
    }

    if (!all.length) {
      console.log("✅ Prefetch translations: всё переведено");
      return { planned: 0, missing: 0 };
    }

    const batch = pickBatch(all);

    // Полные документы — только для отобранной партии. enqueueTranslation
    // кладёт сущность целиком в задачу (её читает воркер: title, content,
    // abstract, originalLanguage, translationVersion), поэтому текст нужен, но
    // лишь у тех, кого ставим в очередь прямо сейчас.
    const needed = new Map();
    for (const p of batch) {
      const key = `${p.entityType}:${p.entityId}`;
      if (!needed.has(key)) needed.set(key, p);
    }

    const docs = new Map();
    for (const spec of MODELS) {
      const ids = [...needed.values()]
        .filter((p) => p.entityType === spec.entityType)
        .map((p) => p.entityId);
      if (!ids.length) continue;
      const found = await spec.model.find({ _id: { $in: ids } }).lean();
      for (const d of found) docs.set(`${spec.entityType}:${d._id}`, d);
    }

    let planned = 0;
    for (const p of batch) {
      const entity = docs.get(`${p.entityType}:${p.entityId}`);
      if (!entity) continue;
      await enqueueTranslation({
        entity,
        entityType: p.entityType,
        targetLanguage: p.targetLanguage,
      });
      planned += 1;
    }

    console.log(
      `✅ Prefetch translations: запланировано ${planned}, осталось ${all.length - planned}`,
    );
    return { planned, missing: all.length };
  } catch (err) {
    // Крон не должен падать: следующий запуск через десять минут всё равно
    // подберёт то, что не доехало.
    console.error("❌ Prefetch translations:", err?.message);
    return { planned: 0, missing: 0, error: err?.message };
  }
};

export default prefetchTranslations;
