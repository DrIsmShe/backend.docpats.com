// server/modules/previsit/models/previsitIntake.model.js
// ─────────────────────────────────────────────────────────────────────
//   Опрос пациента перед приёмом.
//
//   ЭТО НЕ ЗАПИСЬ В КАРТЕ. Карту ведёт врач и подписывает её. Здесь —
//   рассказ пациента о себе, собранный до приёма. Смешивать нельзя:
//   слова пациента и вывод врача имеют разный вес, и в медицинском
//   документе они обязаны быть различимы.
//
//   Поэтому анкета живёт отдельной коллекцией и попадает в карту только
//   тогда, когда врач сам перенесёт из неё то, что счёл нужным.
//
//   ДОСТУП ПО ПОДПИСАННОЙ ССЫЛКЕ. У пациента клиники аккаунта может не
//   быть вовсе — его завела регистратура. Требовать регистрации ради
//   анкеты значит не получить анкету. Ссылка живёт до приёма плюс сутки:
//   после приёма она бесполезна, а вечная ссылка — способ открыть чужую
//   анкету по пересланному письму.
// ─────────────────────────────────────────────────────────────────────

import mongoose from "mongoose";

const { Schema } = mongoose;

export const INTAKE_STATUSES = ["invited", "submitted"];

const previsitIntakeSchema = new Schema(
  {
    appointmentId: {
      type: Schema.Types.ObjectId,
      ref: "ClinicAppointment",
      required: true,
      unique: true, // одна анкета на приём: вторая перезаписала бы первую
      index: true,
    },
    clinicId: {
      type: Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
      index: true,
    },
    patientId: {
      type: Schema.Types.ObjectId,
      ref: "ClinicPatient",
      required: true,
      index: true,
    },
    // Чей тариф оплачивает разбор анкеты. Врач, а не пациент: анкету
    // приглашает клиника, и бесплатный пациент не должен упираться в
    // чужую квоту, заполняя её по просьбе врача.
    doctorId: { type: Schema.Types.ObjectId, ref: "User", default: null },

    status: { type: String, enum: INTAKE_STATUSES, default: "invited" },

    // Ответы как есть — ключ вопроса → значение. Схема свободная
    // намеренно: набор вопросов живёт в коде и будет меняться, а
    // старые анкеты обязаны читаться после каждого изменения.
    answers: { type: Schema.Types.Mixed, default: {} },

    // Отмеченные тревожные признаки. Отдельным полем, а не внутри
    // answers: по ним ищут и по ним сортируют, и они не должны
    // потеряться при следующей правке набора вопросов.
    redFlags: { type: [String], default: [] },

    // ─── Разбор для врача ────────────────────────────────────────
    // Связный анамнез, собранный моделью из ответов. Пустой, если
    // квота клиники исчерпана или модель недоступна: ответы пациента
    // важнее разбора и сохраняются в любом случае.
    narrative: { type: String, default: "", trim: true },
    // Что стоит уточнить на приёме. Не диагнозы и не назначения —
    // вопросы, которые следуют из рассказа.
    clarify: { type: [String], default: [] },

    provenance: {
      model: { type: String, default: null },
      promptVersion: { type: String, default: null },
    },

    submittedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "previsit_intakes" },
);

// Врач открывает анкету по приёму; клиника смотрит свежие.
previsitIntakeSchema.index({ clinicId: 1, submittedAt: -1 });
previsitIntakeSchema.index({ patientId: 1, submittedAt: -1 });

const PrevisitIntake =
  mongoose.models.PrevisitIntake ||
  mongoose.model("PrevisitIntake", previsitIntakeSchema, "previsit_intakes");

export default PrevisitIntake;
