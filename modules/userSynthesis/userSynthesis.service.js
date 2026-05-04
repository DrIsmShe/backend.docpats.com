import Anthropic from "@anthropic-ai/sdk";
import UserSynthesis from "./userSynthesis.model.js";
import User from "../../common/models/Auth/users.js";
import {
  PLAN_LIMITS,
  resolveEffectivePlan,
  getLimit,
} from "../../common/config/aiPlanLimits.js";

// ─── Роли пациентов (для дисклеймера и блокировки личных тем) ──
const PATIENT_ROLES = ["patient", "user"];

// ─── Паттерны личных мед.запросов ──────────────────────────────
const PERSONAL_PATTERNS = [
  /\b(у меня|у моего|у моей|у моих|у мужа|у жены|у сына|у дочери|у ребёнка|у ребенка|меня болит|мне больно|мой диагноз|моя болезнь|моё заболевание|мое заболевание|у меня болит|у меня боли|я болею|я заболел|я заболела)\b/i,
  /\b(my (pain|symptoms?|diagnosis|condition|disease|illness)|i have (a |an |the )?(pain|symptoms?|fever|cough|cancer|diabetes|tumor|illness)|i('?m| am) suffering|i feel sick)\b/i,
  /\b(bende\s+(ağrı|hastalık|şikayet)|benim\s+(ağrım|hastalığım|şikayetim))\b/i,
  /\b(məndə\s+(ağrı|xəstəlik)|mənim\s+(ağrım|xəstəliyim))\b/i,
];

function isPersonalMedicalQuery(topic = "") {
  return PERSONAL_PATTERNS.some((p) => p.test(topic));
}

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// ────────────────────────────────────────────────────────────────
// ПРОВЕРКА ЛИМИТА — теперь работает через resolveEffectivePlan
// ────────────────────────────────────────────────────────────────
export async function checkUserLimit(userId) {
  if (!userId) {
    console.log("[checkUserLimit] userId=null → guest");
    const limit = getLimit("guest", "aiArticles");
    return {
      allowed: true,
      used: 0,
      limit,
      plan: "guest",
      role: "guest",
      remaining: limit,
    };
  }

  const user = await User.findById(userId).lean();
  if (!user) throw new Error("Пользователь не найден");

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
  topic,
  sources = [],
  language = "ru",
  style = "analytical",
}) {
  const limitCheck = await checkUserLimit(userId);

  if (!limitCheck.allowed) {
    throw new Error(
      `Лимит исчерпан. Использовано ${limitCheck.used} из ${limitCheck.limit} статей в этом месяце. Обновите план.`,
    );
  }

  const isPatient = PATIENT_ROLES.includes(limitCheck.role);
  if (isPatient && isPersonalMedicalQuery(topic)) {
    throw new Error(
      "Этот генератор пишет образовательные статьи по общим медицинским темам, а не консультирует по личным вопросам здоровья. Для персонального вопроса воспользуйтесь AI-консультацией или запишитесь к врачу.",
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
ОБЯЗАТЕЛЬНЫЙ объём: не менее 3000 слов.${disclaimerInstruction}

ИСТОЧНИКИ:
${sourcesText}

ТРЕБОВАНИЯ:
1. Минимум 3000 слов
2. Синтез источников в единый авторский нарратив
3. Конкретные данные и механизмы
4. Живой язык без шаблонных фраз
5. Не упоминай ИИ
6. В конце каждого раздела — блок "Что это значит на практике:" (2-3 предложения)
7. ОБЯЗАТЕЛЬНО завершить статью разделом Литература с 10 источниками

СТРУКТУРА (строго соблюдай):
# [Яркий заголовок]
${isGuestOrPatient ? "> [Блок-дисклеймер из инструкции выше]\n" : ""}[Введение — 400-500 слов]
## [Раздел 1] — 600-700 слов
## [Раздел 2] — 600-700 слов
## [Раздел 3] — 500-600 слов
## [Раздел 4] — 400-500 слов
## Заключение — 300-400 слов
## Литература

ВАЖНО: Раздел "Литература" — ОБЯЗАТЕЛЬНЫЙ. Приведи ровно 10 реальных источников из PubMed, The Lancet, NEJM, WHO, CDC, PLOS Medicine.

Формат каждого источника:
[1] Фамилия И.О., Фамилия И.О. Название статьи. Название журнала. Год; Том(Номер): Страницы. DOI

Пример:
[1] Smith J.A., Johnson R.B. Gut microbiome alterations in type 2 diabetes. Nature Medicine. 2023; 29(4): 891-902. https://doi.org/10.1038/s41591-023-0001-1

Начни с # заголовка и закончи разделом Литература:`;

  const message = await getClient().messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 16000,
    messages: [{ role: "user", content: prompt }],
  });

  if (!message.content?.[0]?.text) {
    throw new Error("Пустой ответ от AI. Попробуйте ещё раз.");
  }

  const body = message.content[0].text;
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
  if (!article) throw new Error("Статья не найдена");
  return article;
}
