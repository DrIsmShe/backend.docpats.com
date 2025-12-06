// server/modules/doctorProfile/controllers/articlesAllController.js
import sanitizeHtml from "sanitize-html";
import mongoose from "mongoose";
import Article from "../../../common/models/Articles/articles.js";
import User, { decrypt } from "../../../common/models/Auth/users.js";

// Если у тебя есть явные модели, можно подставить реальные имена коллекций
// import Category from "../../../common/models/category.js";
// import ProfileDoctor from "../../../common/models/profileDoctor.js";
// import CommentDocpats from "../../../common/models/commentDocpats.js";
// const CATEGORIES = Category.collection.name;
// const DOCTOR_PROFILES = ProfileDoctor.collection.name;
// const COMMENTS = CommentDocpats.collection.name;
// const USERS = User.collection.name;

const USERS = "users";
const CATEGORIES = "categories";
const DOCTOR_PROFILES = "doctorprofiles";
const COMMENTS = "commentdocpats";
const SPECIALIZATIONS = "specializations";

/* ===== helpers: чистый текст и превью ===== */
const stripHtmlToText = (html) =>
  sanitizeHtml(html || "", { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, " ")
    .trim();

const makePreview = (html, maxWords = 30) => {
  const text = stripHtmlToText(html);
  if (!text) return "";
  const words = text.split(/\s+/);
  return words.length <= maxWords
    ? text
    : words.slice(0, maxWords).join(" ") + "…";
};

const toInt = (v, def, min, max) => {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return def;
  return Math.max(min ?? n, Math.min(max ?? n, n));
};
const toBool = (v) => v === true || v === "true" || v === "1";
const norm = (s) => (s || "").toString().trim();

const buildRegex = (s) => {
  const q = norm(s);
  if (!q) return null;
  try {
    return new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  } catch {
    return null;
  }
};

const parseCats = (val) => {
  if (!val) return [];
  if (Array.isArray(val)) return val.map(String).filter(Boolean);
  return String(val)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
};

const articlesAllController = async (req, res) => {
  try {
    /* ----- query ----- */
    const page = Math.max(toInt(req.query.page, 1, 1), 1);
    const perPage = toInt(req.query.perPage, 10, 1, 100);
    const previewWords = toInt(req.query.previewWords, 30, 5, 200);

    const qTitle = norm(req.query.qTitle);
    const qAuthor = norm(req.query.qAuthor);
    const country = norm(req.query.country);
    const specialization = norm(req.query.specialization);
    const cats = parseCats(req.query.cat || req.query.categories);
    const minLikes = Math.max(toInt(req.query.minLikes, 0, 0), 0);
    const withImage = toBool(req.query.withImage);
    const dateFrom = norm(req.query.dateFrom);
    const dateTo = norm(req.query.dateTo);
    const sortBy = norm(req.query.sortBy) || "date_desc";

    /* ----- базовые условия по статье ----- */
    const baseMatch = { isPublished: true };

    // поиск по title + content
    if (qTitle) {
      const rx = buildRegex(qTitle);
      if (rx) baseMatch.$or = [{ title: rx }, { content: rx }];
    }

    // только с изображением
    if (withImage) {
      baseMatch.imageUrl = { $exists: true, $ne: null, $type: "string" };
    }

    // диапазон дат
    if (dateFrom || dateTo) {
      baseMatch.createdAt = {};
      if (dateFrom)
        baseMatch.createdAt.$gte = new Date(`${dateFrom}T00:00:00.000Z`);
      if (dateTo)
        baseMatch.createdAt.$lte = new Date(`${dateTo}T23:59:59.999Z`);
    }

    // минимум лайков (учитываем массив likes или числовое likesCount)
    if (minLikes > 0) {
      baseMatch.$expr = {
        $gte: [
          { $ifNull: [{ $size: { $ifNull: ["$likes", []] } }, "$likesCount"] },
          minLikes,
        ],
      };
    }

    /* ===== Агрегация без пагинации (сначала полностью фильтруем на Mongo) ===== */
    const pipeline = [
      { $match: baseMatch },

      // Автор (User)
      {
        $lookup: {
          from: USERS,
          localField: "authorId",
          foreignField: "_id",
          as: "author",
        },
      },
      { $unwind: { path: "$author", preserveNullAndEmptyArrays: true } },
      // оставляем только статьи с автором
      { $match: { "author._id": { $exists: true } } },

      // Категория (Category) — одиночная
      {
        $lookup: {
          from: CATEGORIES,
          localField: "category",
          foreignField: "_id",
          as: "categoryDoc",
        },
      },
      { $unwind: { path: "$categoryDoc", preserveNullAndEmptyArrays: true } },

      // Профиль врача → страна (если есть отдельная коллекция)
      {
        $lookup: {
          from: DOCTOR_PROFILES,
          let: { authorId: "$author._id" },
          pipeline: [
            { $match: { $expr: { $eq: ["$userId", "$$authorId"] } } },
            { $project: { country: 1, position: 1 } },
          ],
          as: "doctorProfile",
        },
      },
      { $unwind: { path: "$doctorProfile", preserveNullAndEmptyArrays: true } },

      // Специализация (по ссылке из User)
      {
        $lookup: {
          from: SPECIALIZATIONS,
          localField: "author.specialization",
          foreignField: "_id",
          as: "specializationDoc",
        },
      },
      {
        $unwind: {
          path: "$specializationDoc",
          preserveNullAndEmptyArrays: true,
        },
      },

      // Подсчёт комментариев к статье
      {
        $lookup: {
          from: COMMENTS,
          let: { aid: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$targetId", "$$aid"] },
                    { $eq: ["$targetType", "Article"] },
                    { $eq: ["$isDeleted", false] },
                  ],
                },
              },
            },
            { $count: "count" },
          ],
          as: "commentStats",
        },
      },

      // Нормализация и вычисления
      {
        $addFields: {
          likesCount: { $size: { $ifNull: ["$likes", []] } },
          commentCount: {
            $ifNull: [{ $arrayElemAt: ["$commentStats.count", 0] }, 0],
          },

          // страна: приоритетно из профиля, иначе из User.country
          countryUnified: {
            $ifNull: ["$doctorProfile.country", "$author.country"],
          },

          // имя поля для быстрой серверной фильтрации по автору, если оно есть:
          // (см. рекомендацию по добавлению fullNameSearchLower в users)
          authorNameSearchLower: {
            $ifNull: ["$author.fullNameSearchLower", ""],
          },

          specializationName: "$specializationDoc.name",

          // Категории: учитываем одиночную categoryDoc.name и массив categories[].name, если есть
          categoryNames: {
            $setUnion: [
              {
                $cond: [
                  {
                    $and: [
                      { $ne: ["$categoryDoc", null] },
                      { $ne: ["$categoryDoc.name", null] },
                    ],
                  },
                  ["$categoryDoc.name"],
                  [],
                ],
              },
              {
                $map: {
                  input: {
                    $filter: {
                      input: { $ifNull: ["$categories", []] },
                      as: "c",
                      cond: {
                        $and: [
                          { $ne: ["$$c", null] },
                          { $ne: ["$$c.name", null] },
                        ],
                      },
                    },
                  },
                  as: "c",
                  in: "$$c.name",
                },
              },
            ],
          },
        },
      },

      // Фильтры по стране/специализации/категориям
      ...(() => {
        const and = [];
        if (country && country !== "all") {
          and.push({ countryUnified: country });
        }
        if (specialization && specialization !== "all") {
          and.push({
            $expr: {
              $eq: [
                { $toLower: { $ifNull: ["$specializationName", ""] } },
                specialization.toLowerCase(),
              ],
            },
          });
        }
        if (cats.length) {
          and.push({
            $expr: {
              $gt: [
                {
                  $size: {
                    $setIntersection: [
                      {
                        $map: {
                          input: "$categoryNames",
                          as: "n",
                          in: { $toLower: "$$n" },
                        },
                      },
                      cats.map((x) => x.toLowerCase()),
                    ],
                  },
                },
                0,
              ],
            },
          });
        }
        return and.length ? [{ $match: { $and: and } }] : [];
      })(),

      // Проекция для дальнейшей пост-обработки в JS
      {
        $project: {
          _id: 1,
          title: 1,
          content: 1,
          imageUrl: 1,
          createdAt: 1,
          updatedAt: 1,
          likes: 1,
          likesCount: 1,
          commentCount: 1,

          // для расшифровки ФИО
          authorFirstNameEnc: "$author.firstNameEncrypted",
          authorLastNameEnc: "$author.lastNameEncrypted",

          // быстрый серверный поиск по автору, если поле существует
          authorNameSearchLower: 1,

          // для ответа
          country: "$countryUnified",
          specialization: "$specializationName",
          categoryDoc: {
            _id: "$categoryDoc._id",
            name: "$categoryDoc.name",
            slug: "$categoryDoc.slug",
          },
          categoryNames: 1,
        },
      },
    ];

    const raw = await Article.aggregate(pipeline).allowDiskUse(true);

    /* ===== post-filter по ФИО (fallback через расшифровку), если нужно ===== */
    let filtered = raw;

    if (qAuthor) {
      const rx = buildRegex(qAuthor);
      if (rx) {
        // Попробуем сперва серверный быстрый путь (если у документов заполнено authorNameSearchLower)
        const serverFiltered = raw.filter(
          (d) =>
            typeof d.authorNameSearchLower === "string" &&
            d.authorNameSearchLower &&
            rx.test(d.authorNameSearchLower)
        );

        if (serverFiltered.length > 0) {
          filtered = serverFiltered;
        } else {
          // Медленный, но точный путь: расшифровка и сравнение на сервере JS
          filtered = raw.filter((d) => {
            try {
              const fn =
                d.authorFirstNameEnc != null
                  ? decrypt(d.authorFirstNameEnc)
                  : "";
              const ln =
                d.authorLastNameEnc != null ? decrypt(d.authorLastNameEnc) : "";
              const full = `${fn} ${ln}`.trim().toLowerCase();
              return rx.test(full);
            } catch {
              return false;
            }
          });
        }
      }
    }

    /* ===== сортировка (после возможного пост-фильтра по автору) ===== */
    const cmp = (A, B) => {
      switch (sortBy) {
        case "date_asc":
          return new Date(A.createdAt) - new Date(B.createdAt);
        case "likes_desc":
          return (
            (B.likesCount ?? 0) - (A.likesCount ?? 0) ||
            new Date(B.createdAt) - new Date(A.createdAt)
          );
        case "comments_desc":
          return (
            (B.commentCount ?? 0) - (A.commentCount ?? 0) ||
            new Date(B.createdAt) - new Date(A.createdAt)
          );
        case "title_asc": {
          const ta = (A.title || "").toString();
          const tb = (B.title || "").toString();
          return ta.localeCompare(tb, "ru");
        }
        case "author_asc": {
          // сортируем по расшифрованным ФИО
          const fa = (() => {
            try {
              return `${decrypt(A.authorFirstNameEnc) || ""} ${
                decrypt(A.authorLastNameEnc) || ""
              }`
                .trim()
                .toLowerCase();
            } catch {
              return "";
            }
          })();
          const fb = (() => {
            try {
              return `${decrypt(B.authorFirstNameEnc) || ""} ${
                decrypt(B.authorLastNameEnc) || ""
              }`
                .trim()
                .toLowerCase();
            } catch {
              return "";
            }
          })();
          return fa.localeCompare(fb, "ru");
        }
        case "date_desc":
        default:
          return new Date(B.createdAt) - new Date(A.createdAt);
      }
    };
    filtered.sort(cmp);

    /* ===== пагинация на результате ===== */
    const total = filtered.length;
    const totalPages = Math.max(Math.ceil(total / perPage), 1);
    const start = (page - 1) * perPage;
    const end = start + perPage;
    const pageItems = filtered.slice(start, end);

    /* ===== финальная сборка и превью ===== */
    const articles = pageItems.map((a) => {
      const firstName =
        a.authorFirstNameEnc != null
          ? decrypt(a.authorFirstNameEnc) || "Имя"
          : "Имя";
      const lastName =
        a.authorLastNameEnc != null
          ? decrypt(a.authorLastNameEnc) || "Фамилия"
          : "Фамилия";

      return {
        _id: a._id,
        title: stripHtmlToText(a.title) || a.title || "Без заголовка",
        imageUrl: a.imageUrl ?? null,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
        preview: makePreview(a.content, previewWords),

        likes: Array.isArray(a.likes) ? a.likes : [],
        likesCount:
          a.likesCount ?? (Array.isArray(a.likes) ? a.likes.length : 0),
        commentCount: a.commentCount ?? 0,

        author: { firstName, lastName },

        category: a.categoryDoc || null,
        categories: a.categoryNames || [],

        country: a.country || "Не указано",
        specialization: a.specialization || null,
      };
    });

    /* ===== meta: списки специализаций и категорий для селектов ===== */
    // Специализации: по связанной коллекции SPECIALIZATIONS (если используется), иначе distinct из author.specializationName
    const [specializationsAgg, categoriesAgg] = await Promise.all([
      Article.aggregate([
        { $match: { isPublished: true } },
        {
          $lookup: {
            from: USERS,
            localField: "authorId",
            foreignField: "_id",
            as: "author",
          },
        },
        { $unwind: { path: "$author", preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: SPECIALIZATIONS,
            localField: "author.specialization",
            foreignField: "_id",
            as: "specDoc",
          },
        },
        { $unwind: { path: "$specDoc", preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: { $toLower: { $ifNull: ["$specDoc.name", ""] } },
            name: { $first: "$specDoc.name" },
          },
        },
        { $match: { _id: { $ne: "" } } },
        { $sort: { name: 1 } },
      ]),
      Article.aggregate([
        { $match: { isPublished: true } },
        {
          $addFields: {
            categoryNames: {
              $setUnion: [
                {
                  $cond: [
                    {
                      $and: [
                        { $ne: ["$category", null] },
                        { $ne: ["$category.name", null] },
                      ],
                    },
                    ["$category.name"],
                    [],
                  ],
                },
                {
                  $map: {
                    input: {
                      $filter: {
                        input: { $ifNull: ["$categories", []] },
                        as: "c",
                        cond: {
                          $and: [
                            { $ne: ["$$c", null] },
                            { $ne: ["$$c.name", null] },
                          ],
                        },
                      },
                    },
                    as: "c",
                    in: "$$c.name",
                  },
                },
              ],
            },
          },
        },
        { $unwind: "$categoryNames" },
        {
          $group: {
            _id: { $toLower: "$categoryNames" },
            name: { $first: "$categoryNames" },
          },
        },
        { $sort: { name: 1 } },
      ]),
    ]);

    const meta = {
      specializations: specializationsAgg.map((x) => x.name), // показываем «чистое» имя
      categories: categoriesAgg.map((x) => x.name),
    };

    return res.status(200).json({
      page,
      perPage,
      total,
      totalPages,
      meta,
      articles,
    });
  } catch (err) {
    console.error("❌ Ошибка при получении статей:", err);
    return res
      .status(500)
      .json({ message: "Ошибка сервера при получении статей" });
  }
};

export default articlesAllController;
