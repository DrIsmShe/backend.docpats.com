// server/modules/scribe/models/scribeSession.model.js
// ─────────────────────────────────────────────────────────────────────
//   Запись приёма: врач говорит с пациентом, карта пишется сама.
//
//   ─── КАК ЗАПИСЫВАЕТСЯ ЗВУК И ПОЧЕМУ ИМЕННО ТАК ────────────────────
//
//   Видео идёт через Jitsi, встроенный ЧЕРЕЗ IFRAME-API. Из iframe чужие
//   аудиодорожки недоступны — это граница источников, а не недоработка.
//   Серверная запись (Jibri) потребовала бы правки развёртывания Jitsi,
//   которое трогать нельзя.
//
//   Поэтому КАЖДАЯ СТОРОНА ПИШЕТ СВОЙ МИКРОФОН и присылает нам свои
//   куски. Это не обходной манёвр, а лучшее решение по существу:
//
//     • разделение говорящих получается ТОЧНЫМ и бесплатно. Серверное
//       разделение одной дорожки на голоса ошибается на перебиваниях —
//       а перебивания и есть половина приёма. Здесь ошибиться нечем:
//       поток врача пришёл от врача;
//     • согласие становится техническим, а не бумажным. Пациент не
//       согласился — его браузер просто не пишет. Не «мы обещаем не
//       использовать», а «записи не существует»;
//     • качество выше: свой микрофон слышно чисто, а не через два
//       кодека и эхоподавление собеседника.
//
//   ─── СОГЛАСИЕ ─────────────────────────────────────────────────────
//
//   Запись начинается ТОЛЬКО после явного согласия обеих сторон.
//   Сеанс, где пациент не ответил или отказался, остаётся в состоянии
//   awaiting/declined, и куски от него не принимаются.
//
//   Отозвать согласие можно в любой момент — тогда запись прекращается,
//   а уже присланное этой стороной удаляется. Право прервать должно
//   действовать назад, иначе оно ничего не стоит.
// ─────────────────────────────────────────────────────────────────────

import mongoose from "mongoose";

const { Schema } = mongoose;

export const SESSION_STATUSES = [
  "awaiting_consent", // врач начал, ждём ответа пациента
  "recording", // обе стороны согласились, куски принимаются
  "declined", // пациент отказался — записи нет и не будет
  "finishing", // врач завершил, идёт распознавание
  "ready", // черновик собран
  "failed",
  "revoked", // согласие отозвано во время приёма
];

// "unsupported" — устройство участника писать не может (телефон: микрофон
// занят звонком и второй захват отбирает его). Это НЕ отказ, и путать их
// нельзя: отказ — решение человека, и записывать его там, где человек
// ничего не решал, значит подделать запись о согласии.
export const CONSENT_STATES = [
  "pending",
  "granted",
  "declined",
  "revoked",
  "unsupported",
];

const participantSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, enum: ["doctor", "patient"], required: true },
    consent: { type: String, enum: CONSENT_STATES, default: "pending" },
    consentAt: { type: Date, default: null },
    // Сколько кусков приняли от этой стороны. Нужно, чтобы отличить
    // «молчал» от «не записывалось»: первое нормально, второе — сбой.
    chunks: { type: Number, default: 0 },
    seconds: { type: Number, default: 0 },
  },
  { _id: false },
);

const scribeSessionSchema = new Schema(
  {
    // К чему привязан приём. Комната Jitsi — единственное, что есть у
    // обеих сторон в момент разговора.
    room: { type: String, required: true, index: true },
    appointmentId: {
      type: Schema.Types.ObjectId,
      ref: "ClinicAppointment",
      default: null,
      index: true,
    },
    clinicId: { type: Schema.Types.ObjectId, ref: "Clinic", default: null },

    doctorId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // Пациент карты, в которую пойдёт черновик. Может быть null, пока
    // врач не выбрал карту, — запись при этом уже идёт: остановить
    // приём ради выбора карточки нельзя.
    patientRef: { type: Schema.Types.ObjectId, default: null },
    patientTypeModel: {
      type: String,
      enum: ["DoctorPrivatePatient", "NewPatientPolyclinic", "ClinicPatient", null],
      default: null,
    },

    participants: { type: [participantSchema], default: [] },

    status: {
      type: String,
      enum: SESSION_STATUSES,
      default: "awaiting_consent",
      index: true,
    },

    startedAt: { type: Date, default: Date.now },
    finishedAt: { type: Date, default: null },

    // Язык приёма — его называет врач ДО начала записи.
    //
    // Хранится в сеансе, а не берётся каждой стороной из своего браузера,
    // потому что приём один, а браузера два: у врача интерфейс на русском,
    // у пациента на азербайджанском, и распознавать их речь по-разному
    // означало бы получить полразговора на выдуманном языке.
    //
    // Пусто — распознаватель определяет язык сам.
    lang: { type: String, default: "", maxlength: 10 },

    // Реплики после распознавания: кто, когда, что сказал.
    //
    // Хранятся ОТДЕЛЬНЫМИ репликами, а не склеенным текстом, потому что
    // авторство здесь несёт клинический смысл. «Я думаю, у меня
    // воспаление лёгких» из уст пациента — жалоба; та же фраза от врача —
    // предварительный диагноз. Склеив, различить нельзя уже никогда.
    segments: {
      type: [
        {
          _id: false,
          speaker: { type: String, enum: ["doctor", "patient"] },
          startSec: { type: Number, default: 0 },
          text: { type: String, default: "" },
        },
      ],
      default: [],
    },

    // Задание надиктовки, в которое ушла расшифровка. Дальше работает
    // существующий конвейер: структура → черновик → карта.
    dictationJobId: {
      type: Schema.Types.ObjectId,
      ref: "DictationJob",
      default: null,
    },

    error: { type: String, default: "" },
  },
  { timestamps: true, collection: "scribe_sessions" },
);

scribeSessionSchema.index({ doctorId: 1, createdAt: -1 });

// Незавершённые сеансы не должны копиться: аудио к ним уже удалено, а
// сама запись без расшифровки бесполезна через сутки.
scribeSessionSchema.index(
  { createdAt: 1 },
  {
    expireAfterSeconds: 30 * 86400,
    partialFilterExpression: { status: { $in: ["declined", "failed", "revoked"] } },
  },
);

const ScribeSession =
  mongoose.models.ScribeSession ||
  mongoose.model("ScribeSession", scribeSessionSchema, "scribe_sessions");

export default ScribeSession;
