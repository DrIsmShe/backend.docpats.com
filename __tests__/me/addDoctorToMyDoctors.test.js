// Пациент добавляет врача в «Мои доктора».
//
// Здесь было два дефекта, и оба наружу выглядели одинаково — либо «Ошибка
// сервера при добавлении доктора», либо тихо накопленные дубликаты.
//
// 1. Контроллер делал findById + save(), а save() валидирует ВЕСЬ документ
//    пользователя. В схеме обязательны emailHash, firstNameHash, lastNameHash
//    и password: у аккаунта, заведённого до появления любого из них,
//    сохранение падало — на добавлении врача, к которому эти поля отношения
//    не имеют.
//
// 2. myDoctors.includes(doctor._id) сравнивал ObjectId ПО ССЫЛКЕ, поэтому
//    «уже добавлен» не срабатывало никогда.
//
// Оба лечатся одной заменой на атомарный $addToSet, и оба проверяются здесь.

import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import express from "express";
import session from "express-session";
import request from "supertest";

import { createTestDoctor } from "../helpers/createTestUser.js";
import User from "../../common/models/Auth/users.js";
import DoctorProfile from "../../common/models/DoctorProfile/profileDoctor.js";
import addDoctorRoute from "../../modules/patientsProfiles/routes/addDoctorToMyDoctorsRoute.js";

function appAs(userId) {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: "test_secret_at_least_16_chars_long",
      resave: false,
      saveUninitialized: false,
    }),
  );
  app.use((req, _res, next) => {
    req.session.userId = String(userId);
    next();
  });
  app.use("/add-doctor", addDoctorRoute);
  return app;
}

async function seedDoctor() {
  const { userId } = await createTestDoctor();
  const profile = await DoctorProfile.create({
    userId,
    phoneHash: `hash-${new mongoose.Types.ObjectId()}`,
  });
  return { userId, profile };
}

/**
 * Пациент СТАРОГО образца: документ без обязательных хэшей.
 *
 * Пишем в коллекцию напрямую — через модель такой документ не создать, в том
 * и суть: именно на нём save() и падал.
 */
async function seedLegacyPatient() {
  const _id = new mongoose.Types.ObjectId();
  await mongoose.connection.db.collection(User.collection.collectionName).insertOne({
    _id,
    role: "patient",
    createdAt: new Date(),
  });
  return _id;
}

describe("пациент добавляет врача", () => {
  it("работает для аккаунта без обязательных хэшей", async () => {
    const { profile } = await seedDoctor();
    const patientId = await seedLegacyPatient();

    const res = await request(appAs(patientId)).post(`/add-doctor/${profile._id}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("повторное добавление не создаёт дубликат", async () => {
    const { userId: doctorUserId, profile } = await seedDoctor();
    const patientId = await seedLegacyPatient();
    const app = appAs(patientId);

    await request(app).post(`/add-doctor/${profile._id}`);
    const second = await request(app).post(`/add-doctor/${profile._id}`);

    expect(second.status).toBe(400);

    const patient = await mongoose.connection.db
      .collection(User.collection.collectionName)
      .findOne({ _id: patientId });

    const ids = (patient.myDoctors || []).map(String);
    expect(ids).toEqual([String(doctorUserId)]);
  });

  it("несуществующий профиль врача — 404, а не 500", async () => {
    const patientId = await seedLegacyPatient();

    const res = await request(appAs(patientId)).post(
      `/add-doctor/${new mongoose.Types.ObjectId()}`,
    );

    expect(res.status).toBe(404);
  });
});
