// Отзывы врачам и комментарии в кабинете клиники.
//
// В кабинете была модерация только отзывов О КЛИНИКЕ. А на витрине под врачом
// и под статьёй показывается другое: DoctorReview и CommentDocpats. Выходило,
// что клиника не видит того, что висит на её собственных страницах.
//
// Главное, что проверяется, — состав выборки: в неё попадает ровно то, что
// показано на страницах ЭТОЙ клиники, и ничего чужого. Ошибка здесь означала
// бы, что клиника читает отзывы врача, который у неё не работает.

import { describe, it, expect } from "vitest";
import mongoose from "mongoose";

import { createTestDoctor } from "../helpers/createTestUser.js";
import Clinic from "../../modules/clinic/clinic-core/models/clinic.model.js";
import ClinicMembership from "../../modules/clinic/clinic-staff/models/clinicMembership.model.js";
import DoctorProfile from "../../common/models/DoctorProfile/profileDoctor.js";
import DoctorReview from "../../common/models/DoctorProfile/doctorReview.js";
import CommentDocpats from "../../common/models/Comments/CommentDocpats.js";
import Article from "../../common/models/Articles/articles.js";
import { getClinicPublicFeedback } from "../../modules/clinic/clinic-reviews/services/publicFeedback.service.js";

/** Клиника + врач в ней + его статья + отзыв врачу + два комментария. */
async function seed(slug = "testovaya-klinika") {
  const { userId } = await createTestDoctor();

  const profile = await DoctorProfile.create({
    userId,
    // phoneHash уникален и не sparse — второму профилю нужно своё значение.
    phoneHash: `hash-${new mongoose.Types.ObjectId()}`,
  });

  const clinic = await Clinic.create({
    name: "Тестовая клиника",
    slug,
    ownerId: userId,
    isPublished: true,
    isActive: true,
  });

  await ClinicMembership.create({
    userId,
    clinicId: clinic._id,
    role: "doctor",
    actorType: "user",
    isActive: true,
    leftAt: null,
  });

  const article = await Article.create({
    title: "Наушники и здоровье",
    content: "<p>Тело статьи.</p>",
    authorId: userId,
    isPublished: true,
  });

  const patient = await createTestDoctor();

  const review = await DoctorReview.create({
    doctorProfileId: profile._id,
    patientId: patient.userId,
    rating: 5,
    text: "Внимательный врач.",
  });

  const doctorComment = await CommentDocpats.create({
    content: "Спасибо за приём.",
    author: patient.userId,
    targetId: profile._id,
    targetType: "Doctor",
  });

  const articleComment = await CommentDocpats.create({
    content: "Полезная статья.",
    author: patient.userId,
    targetId: article._id,
    targetType: "Article",
  });

  return { clinic, profile, article, review, doctorComment, articleComment };
}

describe("кабинет клиники: отзывы врачам и комментарии", () => {
  it("отдаёт отзыв врачу клиники с именем врача", async () => {
    const { clinic, profile } = await seed();

    const res = await getClinicPublicFeedback({ clinicId: clinic._id });

    expect(res.doctorReviews).toHaveLength(1);
    expect(res.doctorReviews[0].doctorId).toBe(String(profile._id));
    expect(res.doctorReviews[0].rating).toBe(5);
    expect(res.doctorReviews[0].text).toBe("Внимательный врач.");
  });

  it("отдаёт комментарии и к врачу, и к его статье", async () => {
    const { clinic, article } = await seed();

    const res = await getClinicPublicFeedback({ clinicId: clinic._id });

    const types = res.comments.map((c) => c.targetType).sort();
    expect(types).toEqual(["Article", "Doctor"]);

    const onArticle = res.comments.find((c) => c.targetType === "Article");
    // Заголовок цели нужен, чтобы карточка читалась без перехода на страницу.
    expect(onArticle.targetTitle).toBe("Наушники и здоровье");
    expect(String(onArticle.targetId)).toBe(String(article._id));
  });

  it("чужого врача и его комментарии не показывает", async () => {
    const mine = await seed("clinic-a");
    const foreign = await seed("clinic-b");

    const res = await getClinicPublicFeedback({ clinicId: mine.clinic._id });

    expect(res.doctorReviews.map((r) => r.id)).not.toContain(
      String(foreign.review._id),
    );
    expect(res.comments.map((c) => c.id)).not.toContain(
      String(foreign.articleComment._id),
    );
  });

  it("удалённый комментарий в выборку не идёт", async () => {
    const { clinic, articleComment } = await seed();
    await CommentDocpats.updateOne(
      { _id: articleComment._id },
      { $set: { isDeleted: true } },
    );

    const res = await getClinicPublicFeedback({ clinicId: clinic._id });

    expect(res.comments.map((c) => c.id)).not.toContain(
      String(articleComment._id),
    );
  });

  it("клиника без врачей отдаёт пустые списки, а не падает", async () => {
    const { userId } = await createTestDoctor();
    const clinic = await Clinic.create({
      name: "Пустая клиника",
      slug: "pustaya-klinika",
      ownerId: userId,
      isPublished: true,
      isActive: true,
    });

    const res = await getClinicPublicFeedback({ clinicId: clinic._id });

    expect(res).toEqual({ doctorReviews: [], comments: [] });
  });
});
