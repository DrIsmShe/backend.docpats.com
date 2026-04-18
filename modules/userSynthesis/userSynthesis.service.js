import Anthropic from "@anthropic-ai/sdk";
import UserSynthesis from "./userSynthesis.model.js";
import User from "../../common/models/Auth/users.js";

const MONTHLY_LIMITS = {
  free: 1,
  standard: 5,
  premium: 20,
  doctor_free: 3,
  doctor_super: 30,
  doctor_pro: 50,
  clinic: 999,
};

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

export async function checkUserLimit(userId) {
  if (!userId) return { allowed: true, used: 0, limit: 1 };

  const user = await User.findById(userId).lean();
  if (!user) throw new Error("Пользователь не найден");

  const plan = user.subscriptionPlan || "free";
  const limit = MONTHLY_LIMITS[plan] ?? 1;

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const used = await UserSynthesis.countDocuments({
    userId,
    createdAt: { $gte: startOfMonth },
  });

  return {
    allowed: used < limit,
    used,
    limit,
    plan,
    remaining: Math.max(0, limit - used),
  };
}

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
ОБЯЗАТЕЛЬНЫЙ объём: не менее 3000 слов.

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
[Введение — 400-500 слов]
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
    });

    return {
      _id: saved._id,
      title,
      body,
      wordCount,
      remaining: limitCheck.remaining - 1,
      plan: limitCheck.plan,
    };
  }

  return { title, body, wordCount, remaining: 0, plan: "guest" };
}

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
