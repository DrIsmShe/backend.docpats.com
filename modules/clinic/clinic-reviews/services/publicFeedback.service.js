// server/modules/clinic/clinic-reviews/services/publicFeedback.service.js
//
// Отзывы врачам и комментарии, ВИДНЫЕ НА САЙТЕ КЛИНИКИ — для её кабинета.
//
// Зачем отдельно от отзывов клиники. В кабинете есть модерация ClinicReview —
// это отзывы О КЛИНИКЕ, её собственная сущность. Но на витрине под врачом и
// под статьёй показывается другое: DoctorReview (отзыв врачу, привязан к его
// профилю на платформе) и CommentDocpats (комментарий к врачу или статье).
// Эти две сущности клинике не принадлежат, и в кабинете их не было вовсе —
// получалось, что на сайте клиники видно то, чего сама клиника не видит.
//
// ВАЖНО: только чтение. Отзыв врачу оставлен пациентом ВРАЧУ, а не клинике, и
// живёт на его профиле платформы; комментарий — часть общего обсуждения. Дать
// клинике право их прятать значило бы позволить чужой стороне редактировать
// репутацию врача, которая уедет вместе с ним при смене места работы. Кабинету
// нужна видимость — чтобы знать, что происходит на её страницах, — а модерация
// остаётся там, где сущность и заведена.

import mongoose from "mongoose";
import DoctorReview from "../../../../common/models/DoctorProfile/doctorReview.js";
import CommentDocpats from "../../../../common/models/Comments/CommentDocpats.js";
import Article from "../../../../common/models/Articles/articles.js";
import ArticleScine from "../../../../common/models/Articles/articles-scince.js";
import User from "../../../../common/models/Auth/users.js";
import { buildDoctorList } from "../../clinic-public/clinic-public.service.js";

/** Публичное имя: "Имя Ф." — как в остальных публичных агрегатах. */
function publicName(userDoc) {
  if (!userDoc?.decryptFields) return "";
  try {
    const d = userDoc.decryptFields();
    const first = (d.firstName || "").trim();
    const last = (d.lastName || "").trim();
    return [first, last ? `${last.charAt(0)}.` : ""].filter(Boolean).join(" ");
  } catch {
    return "";
  }
}

/** Имена пользователей батчем: id → "Имя Ф." */
async function namesByUserId(ids) {
  const unique = [...new Set(ids.map(String).filter(Boolean))];
  if (!unique.length) return new Map();
  const users = await User.find({ _id: { $in: unique } });
  const map = new Map();
  for (const u of users) map.set(String(u._id), publicName(u));
  return map;
}

/**
 * Отзывы врачам клиники и комментарии к её врачам и их статьям.
 *
 * @param {Object} params
 * @param {string} params.clinicId
 * @param {number} [params.limit=100] потолок на КАЖДЫЙ список
 * @returns {Promise<{doctorReviews: Array, comments: Array}>}
 */
export async function getClinicPublicFeedback({ clinicId, limit = 100 }) {
  const empty = { doctorReviews: [], comments: [] };
  if (!clinicId) return empty;

  // Состав врачей берём тем же сборщиком, что и витрина: показываем ровно то,
  // что видно на публичных страницах клиники, ни строкой больше.
  const doctors = await buildDoctorList(clinicId);
  if (!doctors.length) return empty;

  const profileIds = doctors
    .map((d) => d.id)
    .filter(Boolean)
    .map((id) => new mongoose.Types.ObjectId(String(id)));
  const userIds = doctors
    .map((d) => d.userId)
    .filter(Boolean)
    .map((id) => new mongoose.Types.ObjectId(String(id)));

  const doctorByProfileId = new Map(
    doctors.filter((d) => d.id).map((d) => [String(d.id), d]),
  );

  // Статьи врачей нужны и сами по себе (к ним пишут комментарии), и ради
  // заголовка в карточке: «комментарий к статье N» без названия нечитаем.
  const [reviews, opinions, scientific] = await Promise.all([
    DoctorReview.find({ doctorProfileId: { $in: profileIds } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean(),
    Article.find({ authorId: { $in: userIds } })
      .select("_id title authorId")
      .lean(),
    ArticleScine.find({ authorId: { $in: userIds } })
      .select("_id title authorId")
      .lean(),
  ]);

  const articles = [...opinions, ...scientific];
  const articleById = new Map(articles.map((a) => [String(a._id), a]));

  const comments = await CommentDocpats.find({
    isDeleted: { $ne: true },
    $or: [
      { targetType: "Doctor", targetId: { $in: profileIds } },
      {
        targetType: { $in: ["Article", "ArticleScine"] },
        targetId: { $in: articles.map((a) => a._id) },
      },
    ],
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  const nameById = await namesByUserId([
    ...reviews.map((r) => r.patientId),
    ...comments.map((c) => c.author),
  ]);

  return {
    doctorReviews: reviews.map((r) => {
      const doctor = doctorByProfileId.get(String(r.doctorProfileId));
      return {
        id: String(r._id),
        doctorId: String(r.doctorProfileId),
        doctorName: doctor?.name || "",
        authorName: nameById.get(String(r.patientId)) || "",
        rating: r.rating,
        text: r.text || "",
        reply: r.reply || "",
        status: r.status || "visible",
        createdAt: r.createdAt || null,
      };
    }),
    comments: comments.map((c) => {
      const isDoctor = c.targetType === "Doctor";
      const article = isDoctor ? null : articleById.get(String(c.targetId));
      const doctor = isDoctor
        ? doctorByProfileId.get(String(c.targetId))
        : doctorByProfileId.get(
            String(
              doctors.find(
                (d) => String(d.userId) === String(article?.authorId),
              )?.id || "",
            ),
          );
      return {
        id: String(c._id),
        targetType: c.targetType,
        targetId: String(c.targetId),
        // Заголовок цели: имя врача или название статьи — чтобы карточка в
        // кабинете читалась без перехода на страницу.
        targetTitle: isDoctor ? doctor?.name || "" : article?.title || "",
        doctorId: doctor?.id ? String(doctor.id) : null,
        doctorName: doctor?.name || "",
        authorName: nameById.get(String(c.author)) || "",
        content: c.content || "",
        isReply: Boolean(c.parentComment),
        createdAt: c.createdAt || null,
      };
    }),
  };
}

export default { getClinicPublicFeedback };
