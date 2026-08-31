// common/services/bookingPatient.service.js
//
// «Кто пациент» для любой записи, которую делает врач: приём, операция,
// обследование.
//
// Три вида пациента сводятся к двум ссылкам:
//   registered — аккаунт DocPats (User) или карта поликлиники
//                (NewPatientPolyclinic) → patientId
//   private    — приватная карточка врача (DoctorPrivatePatient)
//                → privatePatientId
//   new        — человек, которого в списках ещё нет: заводим приватную
//                карточку одним движением → privatePatientId
//
// Живёт в common/, а не внутри модуля приёмов, потому что запись на приём и
// запись на вмешательство — разные сущности с ОДИНАКОВОЙ адресацией
// пациента. Скопировать сюда восемьдесят строк с шифрованием ФИО, поиском
// дублей по blind-index и проверкой лимита тарифа значило бы завести вторую
// копию правил, которая разойдётся с первой на первой же правке — и разойдётся
// молча, потому что обе «работают».
//
// Инвариант, который держит эта функция: ровно одна из двух ссылок непустая.
// Обе модели записи проверяют его ещё раз в pre-validate — здесь ошибка
// человеческая («не указан пациент»), там структурная.

import mongoose from "mongoose";
import crypto from "crypto";
import DoctorPrivatePatient from "../models/Polyclinic/DoctorPrivatePatient.js";
import NewPatientPolyclinic from "../models/Polyclinic/newPatientPolyclinic.js";
import User, { decrypt } from "../models/Auth/users.js";
import {
  countDoctorPatients,
  resolvePatientLimit,
} from "../middlewares/requireDoctorPatientLimit.js";

/** Ошибка, которую вызывающий превращает в свой формат ответа. */
export class BookingPatientError extends Error {
  /**
   * Служба не видит запроса, а значит не знает языка собеседника. Поэтому
   * она несёт КОД сообщения, а перевод подставляет обработчик ошибок — там
   * запрос уже есть. Текст остаётся запасным, если кода нет в словаре.
   */
  constructor(message, { status = 400, code = null, i18n = null, extra = {} } = {}) {
    super(message);
    this.name = "BookingPatientError";
    this.status = status;
    this.code = code;
    this.i18n = i18n;
    this.extra = extra;
  }
}

/** Телефон в цифры: поиск дублей должен быть устойчив к скобкам и пробелам. */
export function normalizePhone(v) {
  return String(v || "").replace(/\D/g, "");
}

/**
 * Blind-index телефона — тот же, что считает сеттер поля phoneEncrypted в
 * модели: нормализованный вид "+<цифры>", sha256 в нижнем регистре.
 * Повторён здесь, потому что модель хэш наружу не отдаёт, а искать дубль надо
 * ДО создания документа.
 */
export function phoneHashOf(digits) {
  if (!digits) return null;
  return crypto.createHash("sha256").update(`+${digits}`).digest("hex");
}

/**
 * @param {object} args
 * @param {object} args.patient        - { kind, id?, firstName?, lastName?, phone? }
 * @param {mongoose.Types.ObjectId} args.doctorProfileId - DoctorProfile._id
 * @param {mongoose.Types.ObjectId} args.doctorUserId    - User._id врача
 * @returns {Promise<{patientId, privatePatientId, notifyUserId, patientName}>}
 *          notifyUserId — кому слать уведомление; null, если аккаунта нет.
 */
export async function resolveBookingPatient({
  patient = {},
  doctorProfileId,
  doctorUserId,
}) {
  if (patient.kind === "registered") {
    if (!mongoose.Types.ObjectId.isValid(patient.id)) {
      throw new BookingPatientError("Не указан пациент", { i18n: "app.patient.notSpecified" });
    }
    // В patientId исторически кладут то User._id, то id карты поликлиники —
    // принимаем оба и запоминаем, кому уходит уведомление.
    const asUser = await User.findById(patient.id)
      .select("firstNameEncrypted lastNameEncrypted")
      .lean();
    if (asUser) {
      return {
        patientId: asUser._id,
        privatePatientId: null,
        notifyUserId: asUser._id,
        patientName: [
          decrypt(asUser.firstNameEncrypted),
          decrypt(asUser.lastNameEncrypted),
        ]
          .filter(Boolean)
          .join(" "),
      };
    }

    const card = await NewPatientPolyclinic.findById(patient.id)
      .select("firstNameEncrypted lastNameEncrypted linkedUserId")
      .lean();
    if (!card) {
      throw new BookingPatientError("Пациент не найден", { status: 404, i18n: "app.patient.notFound" });
    }
    return {
      patientId: card._id,
      privatePatientId: null,
      notifyUserId: card.linkedUserId || null,
      patientName: [
        decrypt(card.firstNameEncrypted),
        decrypt(card.lastNameEncrypted),
      ]
        .filter(Boolean)
        .join(" "),
    };
  }

  if (patient.kind === "private") {
    if (!mongoose.Types.ObjectId.isValid(patient.id)) {
      throw new BookingPatientError("Не указан пациент", { i18n: "app.patient.notSpecified" });
    }
    // Фильтр по doctorProfileId — не украшение: без него врач мог бы
    // записать чужую карточку и увидеть её имя в своём календаре.
    const card = await DoctorPrivatePatient.findOne({
      _id: patient.id,
      doctorProfileId,
    });
    if (!card) {
      throw new BookingPatientError("Пациент не найден", { status: 404, i18n: "app.patient.notFound" });
    }
    return {
      patientId: null,
      privatePatientId: card._id,
      notifyUserId: card.linkedUserId || null,
      patientName: card.fullName,
    };
  }

  if (patient.kind === "new") {
    const firstName = String(patient.firstName || "").trim();
    const lastName = String(patient.lastName || "").trim();
    if (!firstName || !lastName) {
      throw new BookingPatientError("Укажите имя и фамилию пациента", { i18n: "app.patient.nameRequired" });
    }

    const phone = normalizePhone(patient.phone);

    // Дубликат по телефону — самая частая ошибка регистратуры: тот же
    // человек звонит второй раз и заводится заново.
    if (phone) {
      const existing = await DoctorPrivatePatient.findOne({
        doctorProfileId,
        phoneHash: phoneHashOf(phone),
      });
      if (existing) {
        return {
          patientId: null,
          privatePatientId: existing._id,
          notifyUserId: existing.linkedUserId || null,
          patientName: existing.fullName,
        };
      }
    }

    const limit = await resolvePatientLimit(doctorUserId);
    if (limit !== -1) {
      const current = await countDoctorPatients(doctorUserId);
      if (current >= limit) {
        throw new BookingPatientError(
          "Достигнут лимит пациентов по вашему тарифу",
          { status: 403, code: "PLAN_LIMIT_REACHED", extra: { limit, current } },
        );
      }
    }

    const card = new DoctorPrivatePatient({
      doctorProfileId,
      doctorUserId,
    });
    // Через виртуалы — они же шифруют и считают blind-index хэши.
    card.firstName = firstName;
    card.lastName = lastName;
    if (phone) card.phoneNumber = phone;
    await card.save();

    return {
      patientId: null,
      privatePatientId: card._id,
      notifyUserId: card.linkedUserId || null,
      patientName: card.fullName,
    };
  }

  throw new BookingPatientError("Не указан тип пациента");
}

export default resolveBookingPatient;
