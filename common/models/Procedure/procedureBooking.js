// common/models/Procedure/procedureBooking.js
//
// Запись пациента на ОПЕРАЦИЮ или ОБСЛЕДОВАНИЕ.
//
// Почему отдельная сущность, а не поле «тип визита» в Appointment
// ─────────────────────────────────────────────────────────────────────
// Приём и вмешательство различаются не подписью, а всем поведением:
//
//   * длительность. Приём — слот сетки (20 минут по умолчанию), операция —
//     часы. Загонять операцию в слоты значит либо резать её на куски, либо
//     ломать генератор сетки для всех.
//   * подготовка. У операции есть предоперационный период: натощак, отмена
//     антикоагулянтов, анализы. У приёма ничего этого нет, и половина полей
//     общей модели стояла бы пустой у большинства записей.
//   * жизненный цикл. У приёма исход бинарный (состоялся / не пришёл).
//     У вмешательства есть «перенесено» — состояние, которого у приёма не
//     бывает и которое нельзя выразить через cancelled, не потеряв причину.
//   * доступ и отчётность. «Сколько операций за месяц» — вопрос, который не
//     должен требовать фильтра по полю-дискриминатору в каждом запросе, и не
//     должен молча включать приёмы, если фильтр забыли.
//
// Общее с Appointment — только адресация пациента: те же две ссылки
// (аккаунт / приватная карточка врача) с тем же правилом «ровно одна».
// Повторено намеренно: это контракт данных, а не код, и общий базовый класс
// связал бы две модели, которые дальше расходятся.
//
// Пересечения по времени считаются ПО ОБЕИМ коллекциям сразу — врач не может
// одновременно оперировать и вести приём. Этим занимается сервис
// (modules/procedures/services/procedure.service.js), а не модель.

import mongoose from "mongoose";

// ─── Константы ────────────────────────────────────────────────────────

// Два вида вмешательства. Списком, а не булевым флагом: третий вид
// (манипуляция, дневной стационар) появится, и булево пришлось бы ломать.
export const PROCEDURE_KINDS = Object.freeze(["surgery", "examination"]);

// Жизненный цикл:
//   planned → confirmed → completed
//           ↘ postponed  (перенесено — назначено новое время, старое свободно)
//           ↘ cancelled
//           ↘ no_show
export const PROCEDURE_STATUSES = Object.freeze([
  "planned",
  "confirmed",
  "completed",
  "postponed",
  "cancelled",
  "no_show",
]);

// Статусы, при которых время врача ЗАНЯТО. Остальные слот освобождают.
// postponed освобождает намеренно: перенос на то и перенос, что старое
// время должно стать доступным немедленно.
export const ACTIVE_PROCEDURE_STATUSES = Object.freeze([
  "planned",
  "confirmed",
]);

// Разумные границы длительности. Нижняя — вмешательство короче четверти
// часа это манипуляция на приёме, а не отдельная запись. Верхняя — сутки:
// всё, что дольше, почти наверняка опечатка в дате окончания.
export const MIN_DURATION_MIN = 15;
export const MAX_DURATION_MIN = 24 * 60;

const { Schema } = mongoose;

const procedureBookingSchema = new Schema(
  {
    // ─── Врач ───
    // doctorId — DoctorProfile._id (как в Appointment), doctorIdUser —
    // User._id. Обе ссылки, потому что расписание и карточки приватных
    // пациентов ходят по профилю, а уведомления и аудит — по аккаунту.
    doctorId: {
      type: Schema.Types.ObjectId,
      ref: "DoctorProfile",
      required: true,
      index: true,
    },
    doctorIdUser: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // ─── Пациент — ровно одна из двух ссылок (см. pre-validate) ───
    patientId: {
      type: Schema.Types.ObjectId,
      ref: "NewPatientPolyclinic",
      default: null,
      index: true,
    },
    privatePatientId: {
      type: Schema.Types.ObjectId,
      ref: "DoctorPrivatePatient",
      default: null,
      index: true,
    },

    // ─── Что именно ───
    kind: {
      type: String,
      enum: PROCEDURE_KINDS,
      required: true,
      index: true,
    },
    // Название вмешательства свободным текстом: единого справочника
    // процедур у платформы нет, а заводить его ради первой версии значит
    // отложить саму запись. Код МКБ/CPT — необязательное поле рядом, чтобы
    // те, кто его ведёт, не теряли его в примечаниях.
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 300,
    },
    code: {
      type: String,
      default: null,
      trim: true,
      maxlength: 40,
    },

    // ─── Время ───
    // Всегда UTC-инстанты. Локальные сутки считает сервис по зоне
    // расписания врача — браузер может стоять в другом поясе.
    startsAt: { type: Date, required: true, index: true },
    endsAt: { type: Date, required: true },

    // ─── Место ───
    // Операционная / кабинет / адрес. Свободный текст: у врача частной
    // практики нет справочника помещений, а у клиники он свой и живёт в
    // clinic-модуле.
    place: { type: String, default: null, trim: true, maxlength: 300 },

    // ─── Подготовка ───
    // То, что пациент должен сделать ДО. Показывается ему в уведомлении и
    // в кабинете, поэтому это не примечание врача, а отдельное поле.
    preparation: {
      type: String,
      default: null,
      trim: true,
      maxlength: 2000,
    },
    // Явные флажки самой частой подготовки — чтобы напоминание могло их
    // проговорить, не разбирая свободный текст.
    fasting: { type: Boolean, default: false },
    anesthesia: {
      type: String,
      enum: ["none", "local", "sedation", "regional", "general"],
      default: "none",
    },

    // ─── Примечания врача (не для пациента) ───
    notesDoctor: { type: String, default: null, maxlength: 2000 },

    // ─── Жизненный цикл ───
    status: {
      type: String,
      enum: PROCEDURE_STATUSES,
      default: "planned",
      required: true,
      index: true,
    },
    confirmedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, default: null, maxlength: 500 },
    noShowAt: { type: Date, default: null },
    // Перенос: куда переехала запись. Ссылка на новую, а не перезапись
    // времени в этой — иначе история «сколько раз переносили» теряется, а
    // это ровно то, что спрашивают при разборе жалоб.
    postponedAt: { type: Date, default: null },
    postponedToId: {
      type: Schema.Types.ObjectId,
      ref: "ProcedureBooking",
      default: null,
    },

    // ─── Происхождение ───
    // Записывает только врач: пациент сам себе операцию не назначает.
    // Поле оставлено на будущее (регистратура клиники), но enum закрыт.
    bookedBy: { type: String, enum: ["doctor"], default: "doctor" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },

    isArchived: { type: Boolean, default: false },
    archivedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: "procedure_bookings",
  },
);

// ─── Индексы ──────────────────────────────────────────────────────────
// 1. день врача и поиск пересечений
procedureBookingSchema.index({ doctorId: 1, startsAt: 1, endsAt: 1 });
// 2. история пациента
procedureBookingSchema.index({ patientId: 1, startsAt: -1 });
procedureBookingSchema.index({ privatePatientId: 1, startsAt: -1 });
// 3. отчётность «операций за период»
procedureBookingSchema.index({ doctorIdUser: 1, kind: 1, startsAt: -1 });

// Гонка двойной записи. Два параллельных запроса на одно начало у одного
// врача оба проходят проверку пересечений (check-then-act) и оба вставляются.
// Уникальный partial-индекс делает второй insert ошибкой 11000, которую
// сервис превращает в понятный конфликт. Partial — потому что отменённые и
// завершённые записи на то же время законны.
procedureBookingSchema.index(
  { doctorId: 1, startsAt: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: ["planned", "confirmed"] },
    },
    name: "procedure_slot_unique_active",
  },
);

// ─── Инварианты ───────────────────────────────────────────────────────
procedureBookingSchema.pre("validate", function (next) {
  // Ровно одна ссылка на пациента. Ни нуля (запись в пустоту), ни двух
  // (две разные истории болезни у одной записи).
  const links = [this.patientId, this.privatePatientId].filter(Boolean).length;
  if (links !== 1) {
    return next(
      new Error(
        "Нужна ровно одна ссылка на пациента: patientId или privatePatientId",
      ),
    );
  }

  if (!this.startsAt || !this.endsAt) return next();

  if (this.endsAt.getTime() <= this.startsAt.getTime()) {
    return next(new Error("Окончание должно быть позже начала"));
  }

  const minutes = (this.endsAt - this.startsAt) / 60000;
  if (minutes < MIN_DURATION_MIN) {
    return next(
      new Error(`Длительность не может быть меньше ${MIN_DURATION_MIN} минут`),
    );
  }
  if (minutes > MAX_DURATION_MIN) {
    return next(
      new Error(`Длительность не может превышать ${MAX_DURATION_MIN} минут`),
    );
  }

  next();
});

const ProcedureBooking =
  mongoose.models.ProcedureBooking ||
  mongoose.model("ProcedureBooking", procedureBookingSchema);

export default ProcedureBooking;
