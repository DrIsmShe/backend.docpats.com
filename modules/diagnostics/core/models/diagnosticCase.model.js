// server/modules/diagnostics/core/models/diagnosticCase.model.js
//
// ДЕЛО — единица работы врача: один пациент, один вопрос, любое количество
// материалов. Всё остальное (артефакты, задания, выводы) ссылается сюда.
//
// Приватность здесь строже, чем в остальных модулях, по одной причине: это
// данные ЖИВОГО пациента, а не учебный кейс.
//
//   • Тексты (название, контекст, вывод врача) шифруются AES-256-CBC общим
//     помощником phiCrypto — тем же, что у ClinicPatient и сообщений.
//   • Имя пациента здесь не хранится вообще. Есть ссылка на карту клиники
//     либо произвольная метка врача («мужчина 54, гипертония») — и та шифруется.
//   • deidentified и aiConsent — гейты: без них анализ не запускается.
//     Проверка в analysis.service, а не в контроллере: обойти маршрутом нельзя.

import mongoose from "mongoose";
import { CASE_STATUSES } from "../../constants.js";
import { encryptPHI, decryptPHI } from "../../../../common/utils/phiCrypto.js";

const { Schema } = mongoose;

const diagnosticCaseSchema = new Schema(
  {
    // Врач, который ведёт дело. Дело — личное: чужие дела не видны.
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    // Клиника, если врач работает в контексте клиники. Нужна для разделения
    // данных и для будущей выдачи доступа коллегам.
    clinicId: { type: Schema.Types.ObjectId, ref: "Clinic", default: null, index: true },

    // Пациент: либо карта клиники, либо анонимная метка. Второе — обычный
    // случай консультации по чужому материалу.
    patient: {
      kind: {
        type: String,
        enum: ["clinic_patient", "external", "anonymous"],
        default: "anonymous",
      },
      patientId: { type: Schema.Types.ObjectId, ref: "ClinicPatient", default: null },
      // Метка врача. Шифруется: там почти всегда оказывается что-то про человека.
      label: { type: String, default: "", set: encryptPHI, get: decryptPHI },
      ageYears: { type: Number, default: null, min: 0, max: 130 },
      sex: { type: String, enum: ["male", "female", "other", "unknown"], default: "unknown" },
    },

    title: { type: String, default: "", set: encryptPHI, get: decryptPHI },
    // Клинический вопрос: зачем врач завёл дело. Он же уходит в анализаторы.
    question: { type: String, default: "", set: encryptPHI, get: decryptPHI },
    // Анамнез, жалобы, что уже известно.
    clinicalContext: { type: String, default: "", set: encryptPHI, get: decryptPHI },

    status: { type: String, enum: CASE_STATUSES, default: "draft", index: true },

    // ─── Гейты перед отправкой в модель ───
    // Подтверждение врача, что материалы обезличены (нет ФИО на снимке, в
    // шапке бланка, в имени файла).
    deidentified: { type: Boolean, default: false },
    // Осознанное согласие на обработку внешней моделью. Отдельно от
    // деидентификации: это разные вопросы и разные ответственности.
    aiConsent: {
      confirmed: { type: Boolean, default: false },
      at: { type: Date, default: null },
    },

    // Итог, который пишет и подписывает ВРАЧ. Выводы модели живут отдельно и
    // никогда не подставляются сюда автоматически.
    doctorSummary: { type: String, default: "", set: encryptPHI, get: decryptPHI },
    closedAt: { type: Date, default: null },

    // Счётчики для списка — чтобы не считать агрегатами на каждый показ.
    counts: {
      artifacts: { type: Number, default: 0 },
      findings: { type: Number, default: 0 },
      critical: { type: Number, default: 0 },
    },
  },
  {
    timestamps: true,
    collection: "diagnostic_cases",
    // getters нужны в toJSON/toObject, иначе наружу уйдёт шифртекст. С .lean()
    // геттеры не работают вовсе — там расшифровывать обязан вызывающий код
    // (см. case.service.js → presentCase).
    toJSON: { getters: true },
    toObject: { getters: true },
  },
);

diagnosticCaseSchema.index({ ownerId: 1, status: 1, updatedAt: -1 });

const DiagnosticCase =
  mongoose.models.DiagnosticCase ||
  mongoose.model("DiagnosticCase", diagnosticCaseSchema, "diagnostic_cases");

export default DiagnosticCase;
