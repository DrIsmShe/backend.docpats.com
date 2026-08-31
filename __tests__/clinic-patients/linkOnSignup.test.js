// server/__tests__/clinic-patients/linkOnSignup.test.js
//
// Карта клиники подцепляется к аккаунту при подтверждении почты.
//
// Связь карты с аккаунтом умела возникать только в одну сторону: регистратор
// находил УЖЕ существующего пользователя DocPats. Обратного пути не было, и
// от этого ломался расчёт всего проекта: видеоприём положен только
// зарегистрированным, человек шёл регистрироваться ради него — и получал
// отказ снова, потому что новый аккаунт с картой не связан ничем.
//
// Отдельно проверяется совпадение хэшей. Пользователь и карта считают хэш
// почты РАЗНЫМИ способами (sha256 против hmac с ключом), поэтому наивное
// сравнение User.emailHash с ClinicPatient.emailHash не дало бы совпадений
// никогда — и фича молча не делала бы ничего.

import { describe, it, expect } from "vitest";
import mongoose from "mongoose";

import ClinicPatient, {
  hashValue,
} from "../../modules/clinic/clinic-patients/models/clinicPatient.model.js";
import Notification from "../../common/models/Notification/notification.js";
import { linkClinicCardsByEmail } from "../../modules/clinic/clinic-patients/services/linkOnSignup.service.js";

const oid = () => new mongoose.Types.ObjectId();

/** Карта пациента в клинике — как её заводит регистратор. */
async function makeCard({ clinicId = oid(), email, linkedUserId = null }) {
  return ClinicPatient.create({
    clinicId,
    firstNameEncrypted: "enc:Иван",
    lastNameEncrypted: "enc:Иванов",
    emailHash: email ? hashValue(email) : null,
    linkedUserId,
    createdBy: oid(),
    createdByType: "user",
  });
}

describe("связывание карт при подтверждении почты", () => {
  it("карта с той же почтой подцепляется к аккаунту", async () => {
    const email = "patient@example.com";
    const card = await makeCard({ email });
    const userId = oid();

    const res = await linkClinicCardsByEmail({ email, userId });

    expect(res.linked).toBe(1);
    const fresh = await ClinicPatient.findById(card._id)
      .setOptions({ skipTenantScope: true })
      .lean();
    expect(String(fresh.linkedUserId)).toBe(String(userId));
  });

  it("почта пишется по-разному, а находится всё равно", async () => {
    // Регистратор ввёл с заглавной и пробелами, человек зарегистрировался
    // строчными. Хэш считается от нормализованного значения — совпадёт.
    const card = await makeCard({ email: "  Patient@Example.COM " });
    const res = await linkClinicCardsByEmail({
      email: "patient@example.com",
      userId: oid(),
    });
    expect(res.linked).toBe(1);
    const fresh = await ClinicPatient.findById(card._id)
      .setOptions({ skipTenantScope: true })
      .lean();
    expect(fresh.linkedUserId).toBeTruthy();
  });

  it("чужая почта не связывает ничего", async () => {
    await makeCard({ email: "someone@example.com" });
    const res = await linkClinicCardsByEmail({
      email: "stranger@example.com",
      userId: oid(),
    });
    expect(res.linked).toBe(0);
  });

  it("уже связанную карту не перехватывает", async () => {
    const owner = oid();
    const card = await makeCard({
      email: "shared@example.com",
      linkedUserId: owner,
    });

    const res = await linkClinicCardsByEmail({
      email: "shared@example.com",
      userId: oid(),
    });

    expect(res.linked).toBe(0);
    const fresh = await ClinicPatient.findById(card._id)
      .setOptions({ skipTenantScope: true })
      .lean();
    // Владелец прежний: чужая медкарта не меняет хозяина.
    expect(String(fresh.linkedUserId)).toBe(String(owner));
  });

  it("карты в разных клиниках подцепляются все", async () => {
    const email = "multi@example.com";
    await makeCard({ email, clinicId: oid() });
    await makeCard({ email, clinicId: oid() });

    // Тенантного контекста здесь нет — как и при регистрации. Поиск не
    // должен сузиться до одной клиники.
    const res = await linkClinicCardsByEmail({ email, userId: oid() });
    expect(res.linked).toBe(2);
    expect(new Set(res.clinics).size).toBe(2);
  });

  it("пациент узнаёт о карте — иначе он её не найдёт", async () => {
    const email = "notify@example.com";
    await makeCard({ email });
    const userId = oid();

    await linkClinicCardsByEmail({ email, userId });

    const notes = await Notification.find({ userId }).lean();
    expect(notes.length).toBe(1);
    expect(notes[0].link).toBe("/patient/my-clinics");
    // С кодом, а не готовой фразой: язык выберет читатель.
    expect(notes[0].i18n.title).toBe("app.notify.cardLinked.title");
  });

  it("карта без почты не подцепляется к пустому значению", async () => {
    await makeCard({ email: null });
    const res = await linkClinicCardsByEmail({ email: "", userId: oid() });
    expect(res.linked).toBe(0);
  });
});
