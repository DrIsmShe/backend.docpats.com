// Публичные страницы врача и публикации ВНУТРИ витрины клиники:
//   GET /api/v1/public/clinics/:slug/doctors/:doctorId
//   GET /api/v1/public/clinics/:slug/publications/:id
//
// Те же данные, что на страницах платформы, но по адресу клиники. Главное,
// что здесь проверяется, — ГЕЙТ ПО КЛИНИКЕ. Без него адрес вида
// /<чужая-клиника>/doctors/<врач> показывал бы чужого специалиста в чужом
// оформлении, а /<клиника>/publications/<статья> — чужую статью как публикацию
// своего врача. Оба эндпоинта гостевые, поэтому проверять некому, кроме них
// самих.

import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import mongoose from "mongoose";

import { createTestDoctor } from "../helpers/createTestUser.js";
import clinicPublicRouter from "../../modules/clinic/clinic-public/clinic-public.routes.js";
import Clinic from "../../modules/clinic/clinic-core/models/clinic.model.js";
import ClinicMembership from "../../modules/clinic/clinic-staff/models/clinicMembership.model.js";
import DoctorProfile from "../../common/models/DoctorProfile/profileDoctor.js";
import Article from "../../common/models/Articles/articles.js";
import { getPublicClinicDoctor } from "../../modules/clinic/clinic-public/clinic-public-doctor.service.js";
import { getPublicClinicPublication } from "../../modules/clinic/clinic-public/clinic-public-publication.service.js";

const app = express();
app.use("/api/v1/public", clinicPublicRouter);

/** Клиника + врач в ней + опубликованная статья этого врача. */
async function seedClinicWithDoctor({ slug = "test-clinic", isPublished = true } = {}) {
  const { userId } = await createTestDoctor();

  const profile = await DoctorProfile.create({
    userId,
    about: "Полное описание врача, которое на карточке обрезается до превью.",
    specializationEndYear: 2010,
    // phoneHash в схеме уникален и НЕ sparse: два профиля с null по нему
    // конфликтуют. Второй врач в тесте нужен всегда (проверка чужой клиники),
    // поэтому значение здесь обязано быть разным.
    phoneHash: `hash-${new mongoose.Types.ObjectId()}`,
  });

  const clinic = await Clinic.create({
    name: "Тестовая клиника",
    slug,
    ownerId: userId,
    isPublished,
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
    abstract: "Короткая выжимка.",
    authorId: userId,
    isPublished: true,
  });

  return { userId, clinic, profile, article };
}

describe("витрина: профиль врача", () => {
  it("отдаёт врача клиники с полным «о себе» и его публикациями", async () => {
    const { clinic, profile } = await seedClinicWithDoctor();

    const dto = await getPublicClinicDoctor(clinic.slug, profile._id);

    expect(dto).toBeTruthy();
    expect(dto.id).toBe(String(profile._id));
    expect(dto.about).toContain("обрезается до превью");
    expect(dto.publications).toHaveLength(1);
    expect(dto.publications[0].title).toBe("Наушники и здоровье");
  });

  it("врача чужой клиники по своему адресу не отдаёт", async () => {
    const { clinic } = await seedClinicWithDoctor({ slug: "clinic-a" });
    const foreign = await seedClinicWithDoctor({ slug: "clinic-b" });

    const dto = await getPublicClinicDoctor(clinic.slug, foreign.profile._id);

    expect(dto).toBeNull();
  });

  it("скрытая клиника своих врачей не показывает", async () => {
    const { clinic, profile } = await seedClinicWithDoctor({ isPublished: false });

    expect(await getPublicClinicDoctor(clinic.slug, profile._id)).toBeNull();
  });

  it("на несуществующий id отвечает null, а не падает", async () => {
    const { clinic } = await seedClinicWithDoctor();

    expect(await getPublicClinicDoctor(clinic.slug, "не-objectid")).toBeNull();
    expect(
      await getPublicClinicDoctor(clinic.slug, new mongoose.Types.ObjectId()),
    ).toBeNull();
  });

  it("HTTP: 200 для своего врача, 404 для чужого", async () => {
    const { clinic, profile } = await seedClinicWithDoctor({ slug: "clinic-a" });
    const foreign = await seedClinicWithDoctor({ slug: "clinic-b" });

    const ok = await request(app).get(
      `/api/v1/public/clinics/${clinic.slug}/doctors/${profile._id}`,
    );
    expect(ok.status).toBe(200);
    expect(ok.body.id).toBe(String(profile._id));

    const denied = await request(app).get(
      `/api/v1/public/clinics/${clinic.slug}/doctors/${foreign.profile._id}`,
    );
    expect(denied.status).toBe(404);
    expect(denied.body.code).toBe("CLINIC_DOCTOR_NOT_FOUND");
  });
});

describe("витрина: публикация врача", () => {
  it("отдаёт статью врача клиники вместе с телом и автором", async () => {
    const { clinic, article, profile } = await seedClinicWithDoctor();

    const dto = await getPublicClinicPublication(clinic.slug, article._id);

    expect(dto).toBeTruthy();
    expect(dto.kind).toBe("opinion");
    expect(dto.content).toContain("Тело статьи");
    // doctorId нужен, чтобы со статьи вернуться к врачу ВНУТРИ витрины.
    expect(dto.author.doctorId).toBe(String(profile._id));
  });

  it("статью чужого врача по своему адресу не отдаёт", async () => {
    const { clinic } = await seedClinicWithDoctor({ slug: "clinic-a" });
    const foreign = await seedClinicWithDoctor({ slug: "clinic-b" });

    expect(
      await getPublicClinicPublication(clinic.slug, foreign.article._id),
    ).toBeNull();
  });

  it("неопубликованную статью не отдаёт", async () => {
    const { clinic, userId } = await seedClinicWithDoctor();
    const draft = await Article.create({
      title: "Черновик",
      content: "<p>Ещё не готово.</p>",
      authorId: userId,
      isPublished: false,
    });

    expect(await getPublicClinicPublication(clinic.slug, draft._id)).toBeNull();
  });

  it("HTTP: 404 с кодом, если статьи нет", async () => {
    const { clinic } = await seedClinicWithDoctor();

    const res = await request(app).get(
      `/api/v1/public/clinics/${clinic.slug}/publications/${new mongoose.Types.ObjectId()}`,
    );
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("CLINIC_PUBLICATION_NOT_FOUND");
  });
});
