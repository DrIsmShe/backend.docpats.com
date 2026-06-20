// server/modules/clinic/clinic-public/clinic-publications.service.js
//
// Clinic-as-Brand (этап D) — агрегат публикаций для гостевой страницы /clinics/:slug.
//
// Сценарий 1: статья авторская (Article.authorId → User), привязки к клинике НЕТ.
// На витрине клиники показываем опубликованные статьи врачей этой клиники.
// Список врачей уже собран buildDoctorList() в clinic-public.service.js —
// сюда передаём ГОТОВЫЙ массив userId, чтобы не дублировать выборку membership.
//
// Работает БЕЗ tenant-контекста и БЕЗ авторизации (публичный эндпоинт):
//   - Article — общая модель, не tenant-scoped
//   - User    — общая модель; имя автора через decryptFields() (нужен non-lean doc)
//
// В список НЕ тащим content (тело статьи) — только превью. Тело читается на
// существующей публичной странице /public/articles/:id.

import Article from "../../../common/models/Articles/articles.js";
import User from "../../../common/models/Auth/users.js";

/**
 * Публичное имя автора: "Имя Ф." (как в reviews-агрегате).
 * @param {import("mongoose").Document} userDoc полный doc (не lean!)
 * @returns {string}
 */
function publicAuthorName(userDoc) {
  if (!userDoc?.decryptFields) return "";
  try {
    const d = userDoc.decryptFields();
    const first = (d.firstName || "").trim();
    const last = (d.lastName || "").trim();
    const initial = last ? `${last.charAt(0)}.` : "";
    return [first, initial].filter(Boolean).join(" ");
  } catch {
    return "";
  }
}

/**
 * Собрать публикации врачей клиники.
 * @param {Array<string|import("mongoose").Types.ObjectId>} doctorUserIds
 *        userId врачей клиники (из buildDoctorList → publicDoctorDTO.userId)
 * @param {Object} [opts]
 * @param {number} [opts.limit=6] сколько статей вернуть
 * @returns {Promise<Array>} массив превью-DTO публикаций
 */
export async function getClinicPublicationsByDoctorIds(
  doctorUserIds,
  opts = {},
) {
  const { limit = 6 } = opts;

  const ids = Array.isArray(doctorUserIds) ? doctorUserIds.filter(Boolean) : [];
  if (!ids.length) return [];

  // 1. Опубликованные статьи врачей клиники, только превью-поля
  const articles = await Article.find({
    authorId: { $in: ids },
    isPublished: true,
  })
    .select("title abstract imageUrl authorId views readTime createdAt")
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  if (!articles.length) return [];

  // 2. Имена авторов батчем (decryptFields → нужен non-lean User doc)
  const authorIds = [
    ...new Set(
      articles
        .map((a) => (a.authorId ? String(a.authorId) : null))
        .filter(Boolean),
    ),
  ];
  // без .select() — decryptFields() работает на полном doc (как в buildDoctorList)
  const users = authorIds.length
    ? await User.find({ _id: { $in: authorIds } })
    : [];

  const nameById = new Map();
  for (const u of users) {
    nameById.set(String(u._id), publicAuthorName(u));
  }

  // 3. Превью-DTO в порядке сортировки (createdAt desc)
  return articles.map((a) => ({
    id: String(a._id),
    title: a.title || "",
    abstract: a.abstract || "",
    imageUrl: a.imageUrl || null,
    authorName: a.authorId ? nameById.get(String(a.authorId)) || "" : "",
    readTime: typeof a.readTime === "number" ? a.readTime : 0,
    views: typeof a.views === "number" ? a.views : 0,
    createdAt: a.createdAt || null,
    // ссылка на существующую публичную страницу статьи (паттерн фронта)
    url: `/public/articles/${String(a._id)}`,
  }));
}
