import {
  generateUserSynthesis,
  checkUserLimit,
  getUserArticles,
  getUserArticle,
} from "./userSynthesis.service.js";

// POST /api/user-synthesis/generate
export async function generate(req, res) {
  try {
    // Ни сессия, ни заголовок cookie в лог НЕ пишутся. Подписанная кука —
    // это готовый ключ входа: вставил в браузер и ты этот пользователь, без
    // пароля. Логи читают шире, чем базу, живут дольше и попадают в резервные
    // копии, поэтому им там не место. (На момент правки в логе прода лежало
    // 26 таких кук.)
    const userId = req.session?.userId || null;
    const {
      topic,
      sources = [],
      language = "ru",
      style = "analytical",
    } = req.body;

    if (!topic || topic.trim().length < 3) {
      return res.status(400).json({
        success: false,
        message: "Укажите тему статьи (минимум 3 символа)",
      });
    }

    if (topic.length > 200) {
      return res.status(400).json({
        success: false,
        message: "Тема слишком длинная (максимум 200 символов)",
      });
    }

    const result = await generateUserSynthesis({
      userId,
      // req нужен для учёта гостей: по нему считается отпечаток адреса.
      req,
      topic: topic.trim(),
      sources,
      language,
      style,
    });

    res.json({ success: true, ...result });
  } catch (err) {
    const isLimitError = err.message.includes("Лимит исчерпан");
    res.status(isLimitError ? 403 : 500).json({
      success: false,
      message: err.message,
    });
  }
}

// GET /api/user-synthesis/limit
export async function getLimit(req, res) {
  try {
    const userId = req.session?.userId || null;
    // Без consume: страница спрашивает счётчик при каждом открытии, и списывать
    // здесь попытку значило бы тратить лимит на просмотр.
    const result = await checkUserLimit(userId, { req });

    console.log("[LIMIT] checkUserLimit result =", result);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    res.json({ success: true, ...result });
  } catch (err) {
    console.error("[LIMIT] ERROR:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// GET /api/user-synthesis/my
export async function getMy(req, res) {
  try {
    console.log("━━━━━━━━━━ [MY] ━━━━━━━━━━");
    console.log("[MY] userId =", req.session?.userId);

    const userId = req.session?.userId;
    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "Не авторизован" });
    }
    const { page, limit } = req.query;
    const result = await getUserArticles(userId, { page, limit });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// GET /api/user-synthesis/my/:id
export async function getMyOne(req, res) {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "Не авторизован" });
    }
    const article = await getUserArticle(userId, req.params.id);
    res.json({ success: true, article });
  } catch (err) {
    res.status(404).json({ success: false, message: err.message });
  }
}
