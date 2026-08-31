import Anthropic from "@anthropic-ai/sdk";
import UserSynthesis from "./userSynthesis.model.js";
import User from "../../common/models/Auth/users.js";
import {
  PLAN_LIMITS,
  resolveEffectivePlan,
  getLimit,
} from "../../common/config/aiPlanLimits.js";
import {
  consumeGuestQuota,
  peekGuestQuota,
} from "../../common/services/guestQuota.service.js";
import { verifyAndAnnotate } from "../../common/services/citationCheck.service.js";

// ─── Роли пациентов: генератор им недоступен ──────────────────
const PATIENT_ROLES = ["patient", "user"];

// Здесь же лежал список PERSONAL_PATTERNS — набор выражений на четырёх
// языках («у меня болит», «my symptoms», «bende ağrı», «məndə ağrı»),
// которым пациенту отсекали личные вопросы, оставляя общие темы. Он стал
// не нужен: пациенту отказано целиком, и различать формулировки незачем.
// Понадобится вернуть — см. историю git.

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// ────────────────────────────────────────────────────────────────
// ПРОВЕРКА ЛИМИТА — теперь работает через resolveEffectivePlan
// ────────────────────────────────────────────────────────────────
/**
 * Вырезает из готовой статьи неподтверждённые ссылки.
 *
 * Работает только с разделом «Литература»: остальной текст не трогаем — там
 * ссылок в проверяемом виде нет, а резать по живому опаснее, чем оставить.
 *
 * Ошибку проверки НЕ пробрасываем: статья без сверки лучше, чем отсутствие
 * статьи из-за недоступности стороннего реестра.
 */
async function cleanCitations(body) {
  const match = body.match(/(##\s*(?:Литература|References|Ədəbiyyat|Kaynakça|المراجع)\s*\n)([\s\S]*)$/i);
  if (!match) return { body, citationReport: null };

  const [, heading, list] = match;

  try {
    const result = await verifyAndAnnotate(list);
    const annotated = body.slice(0, match.index) + heading + result.text;

    return {
      body: annotated,
      citationReport: {
        ok: result.ok,
        flagged: result.flagged.length,
        unchecked: result.unchecked,
        details: result.flagged,
      },
    };
  } catch (err) {
    console.warn("[userSynthesis] сверка литературы не выполнена:", err.message);
    return { body, citationReport: null };
  }
}

// Общий суточный потолок на ВСЕХ гостей. Личный потолок не защищает от
// десятка адресов, а расход идёт с того же баланса, которым живут надиктовка
// и ночная генерация кейсов. Ноль снимает ограничение.
const GUEST_DAILY_CAP = Number(process.env.USER_SYNTHESIS_GUEST_DAILY_CAP ?? 50);

/**
 * @param {string|null} userId
 * @param {object} [options]
 * @param {object} [options.req]     нужен гостю: по нему считается отпечаток
 * @param {boolean} [options.consume] списать попытку (при генерации), а не
 *   просто посмотреть (при показе счётчика на странице)
 */
export async function checkUserLimit(userId, { req, consume = false } = {}) {
  if (!userId) {
    const limit = getLimit("guest", "aiArticles");

    // Раньше здесь стояло allowed: true, used: 0 захардкоженно — счётчик на
    // странице показывал «0 из 1», но ничего не считал, и открытый эндпоинт
    // генерации тратил деньги без потолка. Теперь считаем по-настоящему.
    const quota = req
      ? consume
        ? await consumeGuestQuota({
            req,
            feature: "aiArticles",
            limit,
            globalDaily: GUEST_DAILY_CAP,
          })
        : await peekGuestQuota({ req, feature: "aiArticles", limit })
      : { allowed: false, used: limit, limit, remaining: 0, reason: "no-request" };

    return { ...quota, plan: "guest", role: "guest" };
  }

  const user = await User.findById(userId).lean();
  if (!user) throw Object.assign(new Error("Пользователь не найден"), { i18n: "app.user.notFound" });

  // Эффективный план учитывает trial для врачей
  const plan = resolveEffectivePlan(user);
  const limit = getLimit(plan, "aiArticles");

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const used = await UserSynthesis.countDocuments({
    userId,
    createdAt: { $gte: startOfMonth },
  });

  console.log(
    `[checkUserLimit] userId=${userId} role=${user.role} plan=${plan} used=${used}/${limit === -1 ? "∞" : limit}`,
  );

  return {
    allowed: limit === -1 || used < limit,
    used,
    limit: limit === -1 ? Infinity : limit,
    plan,
    role: user.role || "patient",
    remaining: limit === -1 ? Infinity : Math.max(0, limit - used),
    trialEndsAt: user.trialEndsAt || null,
  };
}

// ────────────────────────────────────────────────────────────────
// ГЕНЕРАЦИЯ СТАТЬИ
// ────────────────────────────────────────────────────────────────
export async function generateUserSynthesis({
  userId,
  req,
  topic,
  sources = [],
  language = "ru",
  style = "analytical",
}) {
  // consume: true — попытка списывается ДО обращения к модели. Проверка
  // «посмотреть и потом списать» пропускала бы два одновременных запроса при
  // лимите в одну штуку.
  const limitCheck = await checkUserLimit(userId, { req, consume: true });

  if (!limitCheck.allowed) {
    if (limitCheck.reason === "global") {
      throw new Error(
        "Бесплатные генерации на сегодня закончились. Войдите в аккаунт — у зарегистрированных свой лимит.",
      );
    }
    throw new Error(
      `Лимит исчерпан. Использовано ${limitCheck.used} из ${limitCheck.limit} статей в этом месяце. Обновите план.`,
    );
  }

  // Пациенту генератор недоступен целиком, а не только в личных вопросах.
  //
  // Раньше здесь стоял отказ лишь на запрос вида «у меня болит спина», а
  // общие темы пациенту генерировались. На практике это означало, что
  // пациент приходит с единственным интересующим его вопросом — своим — и
  // получает отказ, а тариф при этом продавал ему «8 AI-статей в месяц».
  // Инструмент врачебный: он пишет обзор литературы с проверкой ссылок, и
  // читать его должен тот, кто умеет оценить источники.
  //
  // Проверка остаётся и на сервере, хотя пункты меню из кабинета пациента
  // убраны: прямую ссылку никто не отменял.
  const isPatient = PATIENT_ROLES.includes(limitCheck.role);
  if (isPatient) {
    throw new Error(
      "Этот генератор пишет обзоры медицинской литературы для врачей. Для вопроса о своём здоровье воспользуйтесь AI-консультацией или запишитесь к врачу.",
    );
  }

  const isGuestOrPatient = !userId || isPatient;

  const STYLE_MAP = {
    analytical: "в строгом аналитическом стиле с детальным разбором данных",
    clinical: "в клиническом стиле для практикующих врачей",
    popular: "в научно-популярном стиле для широкой аудитории",
    review: "в формате систематического обзора литературы",
    education: "в образовательном формате для студентов и ординаторов",
  };

  const LANG_MAP = {
    ru: "на русском языке",
    en: "in English",
    az: "Azərbaycan dilində",
    ar: "باللغة العربية",
    tr: "Türkçe",
  };

  const DISCLAIMER_BY_LANG = {
    ru: "⚠️ ВАЖНО: Эта статья — образовательный материал, а не медицинская консультация. Информация не заменяет очный приём врача. Перед любыми решениями о лечении, изменении терапии или приёме препаратов обязательно проконсультируйтесь с лечащим врачом.",
    en: "⚠️ IMPORTANT: This article is educational material, not medical advice. The information does not replace an in-person doctor visit. Before any treatment decisions or medication changes, consult your physician.",
    az: "⚠️ VACİBDİR: Bu məqalə təhsil materialıdır, tibbi məsləhət deyil. Hər hansı müalicə qərarından əvvəl həkiminizlə məsləhətləşin.",
    tr: "⚠️ ÖNEMLİ: Bu makale eğitim amaçlıdır, tıbbi tavsiye değildir. Herhangi bir tedavi kararından önce hekiminize danışın.",
    ar: "⚠️ مهم: هذه المقالة مادة تعليمية وليست استشارة طبية. قبل أي قرار علاجي، استشر طبيبك.",
  };

  const disclaimerInstruction = isGuestOrPatient
    ? `\n\nВАЖНО: В САМОМ НАЧАЛЕ статьи (сразу после заголовка, до введения) ОБЯЗАТЕЛЬНО разместить блок-дисклеймер в виде блока цитаты:\n> ${DISCLAIMER_BY_LANG[language] || DISCLAIMER_BY_LANG.ru}`
    : "";

  const sourcesText =
    sources.length > 0
      ? sources
          .map((s, i) =>
            `
[${i + 1}] "${s.title || "Без названия"}"
URL: ${s.url || "-"}
Авторы: ${s.authors || "не указаны"}
${s.excerpt ? "Аннотация: " + s.excerpt.slice(0, 400) : ""}
`.trim(),
          )
          .join("\n\n")
      : `Тема: ${topic}\n[Используй актуальные данные по теме из открытых медицинских источников]`;

  const prompt = `Ты — опытный медицинский редактор и учёный с 20-летним стажем.

Напиши глубокую аналитическую статью ${LANG_MAP[language] || "на русском языке"} ${STYLE_MAP[style] || STYLE_MAP.analytical}.

Тема: ${topic}
Объём: 2000-3000 слов.${disclaimerInstruction}

ИСТОЧНИКИ:
${sourcesText}

ТРЕБОВАНИЯ:
1. Объём 2000-3000 слов. Не добирай объём водой: лучше короче и плотнее.
2. Синтез источников в единый авторский нарратив
3. Конкретные данные и механизмы
4. Живой язык без шаблонных фраз
5. Не упоминай ИИ
6. В конце каждого раздела — блок "Что это значит на практике:" с КОНКРЕТНЫМ
   выводом: что делать, на что смотреть, чего избегать. Общие слова вроде
   "понимание механизмов помогает выбрать терапию" не годятся — если конкретного
   вывода нет, раздел пропусти.

СТРУКТУРА (строго соблюдай):
# [Яркий заголовок]
${isGuestOrPatient ? "> [Блок-дисклеймер из инструкции выше]\n" : ""}[Введение — 300-400 слов]
## [Раздел 1] — 400-600 слов
## [Раздел 2] — 400-600 слов
## [Раздел 3] — 400-500 слов
## [Раздел 4] — 300-400 слов (если теме есть что сказать; иначе пропусти)
## Заключение — 300-400 слов
## Литература

РАЗДЕЛ "ЛИТЕРАТУРА" — ОСОБЫЕ ПРАВИЛА.

Приводи ТОЛЬКО те работы, в существовании которых уверен и DOI которых помнишь
точно. Количество не задано: пять проверяемых источников лучше десяти, из
которых часть выдумана. Если уверенных источников нет вообще — напиши
"## Литература" и строку "Проверяемых источников по теме привести не удалось".

НЕ ПРИДУМЫВАЙ DOI. Номер, собранный по образцу правдоподобного, — это ложная
ссылка: читатель нажмёт и попадёт на чужую работу или в никуда. Сомневаешься в
номере — не приводи эту работу совсем.

Каждый источник в формате:
[1] Фамилия И.О., Фамилия И.О. Название статьи. Название журнала. Год; Том(Номер): Страницы. https://doi.org/DOI

Все ссылки будут автоматически сверены с реестром Crossref, и не подтвердившиеся
будут удалены из статьи.

Начни с # заголовка и закончи разделом Литература:`;

  const message = await getClient().messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 16000,
    messages: [{ role: "user", content: prompt }],
  });

  if (!message.content?.[0]?.text) {
    throw Object.assign(new Error("Пустой ответ от AI. Попробуйте ещё раз."), { i18n: "app.ai.emptyResponseRetry" });
  }

  const rawBody = message.content[0].text;

  // Сверка литературы с реестром Crossref. Модель пишет ссылки по памяти, и
  // проверка восьми ранее опубликованных статей показала: из 80 ссылок 14
  // указывали на несуществующий DOI, а 20 — на реальный DOI ЧУЖОЙ работы.
  // Вторая категория опаснее: читатель нажимает, попадает на настоящую статью
  // и не видит подлога.
  //
  // Неподтверждённые ПОМЕЧАЮТСЯ, а не удаляются: проверка может ошибиться на
  // нестандартном оформлении записи, и тогда удаление унесло бы достоверный
  // источник безвозвратно. Лишнее предупреждение у хорошей ссылки — цена
  // несопоставимо меньшая.
  const { body, citationReport } = await cleanCitations(rawBody);

  const titleMatch = body.match(/^#\s+(.+)/m);
  const title = titleMatch ? titleMatch[1].trim() : `Обзор: ${topic}`;
  const wordCount = body.split(/\s+/).filter(Boolean).length;

  // ── Генерация SEO-метаданных (без изменений) ────────────────
  let seoData = {};
  try {
    const seoMessage = await getClient().messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1200,
      messages: [
        {
          role: "user",
          content: `Ты — SEO-специалист для медицинского сайта DocPats. На основе статьи сгенерируй профессиональные SEO-метаданные.

Заголовок статьи: ${title}
Тема: ${topic}
Начало статьи: ${body.slice(0, 2000)}

Верни ТОЛЬКО JSON объект без markdown, без пояснений:
{
  "metaDescription": "...",
  "abstract": "...",
  "keywords": ["...", "...", "...", "...", "..."],
  "lsiKeywords": ["...", "...", "...", "...", "..."],
  "tags": ["...", "...", "...", "...", "..."]
}

Требования к каждому полю:

metaDescription (СТРОГО 150-160 символов):
- Первые 50-60 символов: главный ключевой запрос темы
- Середина: конкретная польза или факт из статьи
- Конец: призыв к действию ("Читайте клиническое руководство.", "Узнайте подробнее.", "Полный разбор в статье.")
- Без воды, без общих фраз

abstract (3-5 предложений для E-E-A-T):
- Написан от лица эксперта-практика
- Содержит конкретные цифры или клинические факты из статьи
- Показывает глубину экспертизы
- Полезен читателю как самостоятельный текст

keywords (5 штук — реальные поисковые запросы):
- 2 коротких (1-2 слова): основные термины темы
- 3 длинных хвоста (3-5 слов): конкретные вопросы пользователей
- Используй реальные запросы которые вводят в поисковик

lsiKeywords (5 штук — LSI семантика):
- Семантически связанные термины, НЕ повторяющие keywords
- Синонимы, смежные понятия, связанные симптомы/методы/заболевания
- Обогащают семантическое поле статьи для поисковиков

tags (5 штук — категориальные теги):
- Широкие медицинские специальности и рубрики
- Используются для навигации на сайте

Язык всех полей: ${LANG_MAP[language] || "русский"}.
Только JSON, ничего кроме JSON.`,
        },
      ],
    });

    const rawText = seoMessage.content[0].text.trim();
    console.log("🔍 SEO raw:", rawText.slice(0, 400));

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("JSON не найден в ответе SEO");

    seoData = JSON.parse(jsonMatch[0]);
    console.log("✅ SEO готов:", Object.keys(seoData));
    console.log("📝 metaDescription длина:", seoData.metaDescription?.length);
  } catch (err) {
    console.error("❌ SEO генерация ошибка:", err.message);
    const cleanBody = body.replace(/#+\s/g, "").replace(/\n+/g, " ").trim();
    seoData = {
      metaDescription: cleanBody.slice(0, 155),
      abstract: cleanBody.slice(0, 400),
      keywords: [topic],
      lsiKeywords: [],
      tags: [topic],
    };
  }

  if (userId) {
    const saved = await UserSynthesis.create({
      userId,
      title,
      body,
      specialty: topic,
      language,
      wordCount,
      style,
      // Итог сверки литературы. Хранится, чтобы можно было ответить на вопрос
      // «сколько ссылок в этой статье пришлось убрать» без повторной проверки.
      citationReport,
      sources: sources.map((s) => ({
        title: s.title,
        url: s.url,
        authors: s.authors,
        year: s.year || new Date().getFullYear(),
      })),
      metaDescription: seoData.metaDescription || "",
      abstract: seoData.abstract || "",
      keywords: Array.isArray(seoData.keywords) ? seoData.keywords : [],
      lsiKeywords: Array.isArray(seoData.lsiKeywords)
        ? seoData.lsiKeywords
        : [],
      tags: Array.isArray(seoData.tags) ? seoData.tags : [],
    });

    console.log("💾 Сохранено:", {
      userId,
      role: limitCheck.role,
      plan: limitCheck.plan,
      remaining:
        limitCheck.remaining === Infinity ? "∞" : limitCheck.remaining - 1,
    });

    const remaining =
      limitCheck.remaining === Infinity
        ? Infinity
        : Math.max(0, limitCheck.remaining - 1);

    return {
      _id: saved._id,
      title,
      body,
      wordCount,
      remaining,
      plan: limitCheck.plan,
      role: limitCheck.role,
      metaDescription: saved.metaDescription,
      abstract: saved.abstract,
      keywords: saved.keywords,
      lsiKeywords: saved.lsiKeywords,
      tags: saved.tags,
    };
  }

  return {
    title,
    body,
    wordCount,
    remaining: Math.max(0, limitCheck.remaining - 1),
    plan: "guest",
    role: "guest",
    metaDescription: seoData.metaDescription || "",
    abstract: seoData.abstract || "",
    keywords: Array.isArray(seoData.keywords) ? seoData.keywords : [],
    lsiKeywords: Array.isArray(seoData.lsiKeywords) ? seoData.lsiKeywords : [],
    tags: Array.isArray(seoData.tags) ? seoData.tags : [],
  };
}

// ────────────────────────────────────────────────────────────────
// СПИСОК «МОИ СТАТЬИ»
// ────────────────────────────────────────────────────────────────
export async function getUserArticles(userId, { page = 1, limit = 10 } = {}) {
  const [articles, total] = await Promise.all([
    UserSynthesis.find({ userId })
      .sort({ createdAt: -1 })
      .skip((+page - 1) * +limit)
      .limit(+limit)
      .select("-body")
      .lean(),
    UserSynthesis.countDocuments({ userId }),
  ]);
  return { articles, total, page: +page };
}

export async function getUserArticle(userId, articleId) {
  const article = await UserSynthesis.findOne({
    _id: articleId,
    userId,
  }).lean();
  if (!article) throw Object.assign(new Error("Статья не найдена"), { i18n: "app.article.notFound" });
  return article;
}
