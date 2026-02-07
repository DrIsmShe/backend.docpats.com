import sanitizeHtml from "sanitize-html";
import Article from "../../../common/models/Articles/articles.js";

// Удаляем HTML и сводим пробелы
const stripHtmlToText = (html) => {
  const clean = sanitizeHtml(html || "", {
    allowedTags: [],
    allowedAttributes: {},
  });
  return clean.replace(/\s+/g, " ").trim();
};

// Обрезаем по словам
const makePreview = (html, maxWords = 30) => {
  const text = stripHtmlToText(html);
  if (!text) return "";
  const words = text.split(/\s+/);
  return words.length <= maxWords
    ? text
    : words.slice(0, maxWords).join(" ") + "…";
};

const getMyArticlesDoctorController = async (req, res) => {
  if (!req.session?.userId) {
    return res.status(403).json({ message: "Please sign in." });
  }

  // query: category, page, perPage, previewWords
  const { category } = req.query;

  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const perPageRaw = parseInt(req.query.perPage, 10);
  const perPage = Math.min(Math.max(perPageRaw || 9, 1), 100);

  const previewWordsRaw = parseInt(req.query.previewWords, 10);
  const previewWords = Math.min(Math.max(previewWordsRaw || 30, 5), 200);

  try {
    const query = {
      authorId: req.session.userId,
      ...(category ? { category } : {}),
    };

    const [docs, total] = await Promise.all([
      Article.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * perPage)
        .limit(perPage)
        // без .lean(), чтобы decryptFields был доступен
        .populate("authorId", "firstNameEncrypted lastNameEncrypted"),
      Article.countDocuments(query),
    ]);

    const articles = docs.map((doc) => {
      const obj = doc.toObject({ virtuals: true });

      // Дешифровка автора (без падений)
      let author = { firstName: "Неизвестно", lastName: "" };
      try {
        if (doc.authorId && typeof doc.authorId.decryptFields === "function") {
          author = doc.authorId.decryptFields();
        }
      } catch {}

      return {
        _id: obj._id,
        title: stripHtmlToText(obj.title) || obj.title || "Без заголовка",
        imageUrl: obj.imageUrl || null,
        createdAt: obj.createdAt,
        updatedAt: obj.updatedAt,
        preview: makePreview(obj.content, previewWords), // ✅ чистый текст, ограничен по словам
        contentLength: stripHtmlToText(obj.content).length,
        likes: obj.likes || [],
        category: obj.category || null,
        author, // { firstName, lastName }
      };
    });

    return res.status(200).json({
      page,
      perPage,
      total,
      totalPages: Math.max(Math.ceil(total / perPage), 1),
      articles, // может быть пустым []
    });
  } catch (error) {
    console.error("Error getting articles:", error);
    return res.status(500).json({ message: "Server error." });
  }
};

export default getMyArticlesDoctorController;
