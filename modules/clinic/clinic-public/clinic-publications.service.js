// server/modules/clinic/clinic-public/clinic-publications.service.js
//
// Clinic-as-Brand (этап D) + Часть 5 — агрегат публикаций врачей клиники
// для гостевой страницы /clinics/:slug (блок «Статьи наших врачей»).
//
// Сценарий: статья авторская (Article / ArticleScine, поле authorId → User),
// привязки к клинике НЕТ. На витрине показываем опубликованные статьи врачей
// этой клиники — ОБА типа: обычные («мнения») и научные.
// Список userId врачей собран buildDoctorList() в clinic-public.service.js.
//
// Работает БЕЗ tenant-контекста и БЕЗ авторизации (публичный эндпоинт):
//   - Article / ArticleScine — общие модели, не tenant-scoped
//   - User — имя автора через decryptFields() (нужен non-lean doc)
//
// В список НЕ тащим content (тело) — только превью. Тело читается на
// детейл-странице статьи врача.

import Article from "../../../common/models/Articles/articles.js";
import ArticleScine from "../../../common/models/Articles/articles-scince.js";
import User from "../../../common/models/Auth/users.js";

// Публичные детейл-роуты статей врача (как в NewsList.getItemLink, гость):
//   мнение   → /public/doctor-profile/article-detail-for-all/:id
//   научная  → /public/doctor/article-scientific-detail-for-all/:id
function opinionUrl(id) {
  return `/public/doctor-profile/article-detail-for-all/${id}`;
}
function scientificUrl(id) {
  return `/public/doctor/article-scientific-detail-for-all/${id}`;
}

/** Публичное имя автора: "Имя Ф." (как в reviews-агрегате). */
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
 * Собрать публикации врачей клиники — ОБА типа (мнения + научные).
 * @param {Array<string|import("mongoose").Types.ObjectId>} doctorUserIds
 *        userId врачей клиники (из buildDoctorList → publicDoctorDTO.userId)
 * @param {Object} [opts]
 * @param {number} [opts.limit=12] сколько статей вернуть (всего, после слияния)
 * @returns {Promise<Array>} массив превью-DTO публикаций, новые сверху
 */
export async function getClinicPublicationsByDoctorIds(
  doctorUserIds,
  opts = {},
) {
  const { limit = 12 } = opts;

  const ids = Array.isArray(doctorUserIds) ? doctorUserIds.filter(Boolean) : [];
  if (!ids.length) return [];

  const selectFields =
    "title abstract imageUrl authorId views readTime createdAt";

  // 1. Опубликованные статьи врачей клиники — оба типа параллельно
  const [opinions, scientific] = await Promise.all([
    Article.find({ authorId: { $in: ids }, isPublished: true })
      .select(selectFields)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean(),
    ArticleScine.find({ authorId: { $in: ids }, isPublished: true })
      .select(selectFields)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean(),
  ]);

  // помечаем тип и склеиваем
  const merged = [
    ...opinions.map((a) => ({ ...a, _kind: "opinion" })),
    ...scientific.map((a) => ({ ...a, _kind: "scientific" })),
  ];
  if (!merged.length) return [];

  // 2. сортировка по дате (новые сверху) + общий лимит
  merged.sort(
    (a, b) =>
      new Date(b.createdAt || 0).getTime() -
      new Date(a.createdAt || 0).getTime(),
  );
  const top = merged.slice(0, limit);

  // 3. имена авторов батчем (decryptFields → нужен non-lean User doc)
  const authorIds = [
    ...new Set(
      top.map((a) => (a.authorId ? String(a.authorId) : null)).filter(Boolean),
    ),
  ];
  const users = authorIds.length
    ? await User.find({ _id: { $in: authorIds } })
    : [];
  const nameById = new Map();
  for (const u of users) nameById.set(String(u._id), publicAuthorName(u));

  // 4. превью-DTO
  return top.map((a) => {
    const id = String(a._id);
    return {
      id,
      kind: a._kind, // "opinion" | "scientific"
      title: a.title || "",
      abstract: a.abstract || "",
      imageUrl: a.imageUrl || null,
      authorName: a.authorId ? nameById.get(String(a.authorId)) || "" : "",
      readTime: typeof a.readTime === "number" ? a.readTime : 0,
      views: typeof a.views === "number" ? a.views : 0,
      createdAt: a.createdAt || null,
      url: a._kind === "scientific" ? scientificUrl(id) : opinionUrl(id),
    };
  });
}
