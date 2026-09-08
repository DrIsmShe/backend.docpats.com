// server/modules/video/models/videoPlaylist.model.js
//
// Подготовка к процедуре: шаблон клиники и его назначение пациенту.
//
// ЗАЧЕМ. «За семь дней — диета, за три — подготовка, накануне — что взять с
// собой». Пациент, который этого не знал, приходит неподготовленным, и
// процедуру отменяют: потерянный слот, потерянные деньги, испорченный день
// у обоих. Плейлист — это не библиотека роликов, а расписание объяснений,
// привязанное к дате процедуры.
//
// ДВЕ МОДЕЛИ, А НЕ ОДНА. Шаблон — то, что клиника настроила однажды;
// назначение — то, что получил конкретный человек к конкретной дате.
// Хранить их вместе значило бы, что правка шаблона задним числом меняет уже
// выданные назначения, — а «что именно человеку велели сделать перед его
// процедурой» обязано быть неизменным, как и снимок ролика в согласии.

import mongoose from "mongoose";

/* ── Шаг шаблона ──────────────────────────────────────────────────
   offsetDays — за сколько дней ДО процедуры показать. 0 — в день. */
const stepSchema = new mongoose.Schema(
  {
    videoId: { type: mongoose.Schema.Types.ObjectId, ref: "Video", required: true },
    offsetDays: { type: Number, required: true, min: 0, max: 90 },
    required: { type: Boolean, default: true },
    note: { type: String, trim: true, default: "", maxlength: 500 },
  },
  { _id: false },
);

const videoPlaylistSchema = new mongoose.Schema(
  {
    clinicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
      index: true,
    },
    title: { type: String, trim: true, required: true, maxlength: 300 },
    procedureName: { type: String, trim: true, required: true, maxlength: 300 },
    description: { type: String, trim: true, default: "", maxlength: 2000 },
    steps: {
      type: [stepSchema],
      required: true,
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: "В плане подготовки должен быть хотя бы один ролик",
      },
    },
    active: { type: Boolean, default: true, index: true },
    createdByMembershipId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClinicMembership",
      default: null,
    },
  },
  { timestamps: true },
);

videoPlaylistSchema.index({ clinicId: 1, active: 1, createdAt: -1 });

/* ── Шаг назначения ───────────────────────────────────────────────
   Со снимком ролика — по той же причине, что и в согласии: ролик могут
   переделать, а «что человеку велели посмотреть» меняться не должно.
   dueAt считается от даты процедуры при назначении. */
const assignedStepSchema = new mongoose.Schema(
  {
    videoId: { type: mongoose.Schema.Types.ObjectId, ref: "Video", required: true },
    title: { type: String, trim: true, default: "", maxlength: 300 },
    durationSec: { type: Number, default: 0, min: 0 },
    offsetDays: { type: Number, required: true, min: 0 },
    dueAt: { type: Date, required: true },
    required: { type: Boolean, default: true },
    note: { type: String, trim: true, default: "", maxlength: 500 },

    // Прогресс. Ставится только учётом просмотра — как и в согласии.
    watchedSec: { type: Number, default: 0, min: 0 },
    ratio: { type: Number, default: 0, min: 0, max: 1 },
    completedAt: { type: Date, default: null },
  },
  { _id: false },
);

const videoPlaylistAssignmentSchema = new mongoose.Schema(
  {
    clinicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
      index: true,
    },
    playlistId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "VideoPlaylist",
      default: null,
    },
    clinicPatientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClinicPatient",
      required: true,
      index: true,
    },
    patientUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    appointmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClinicAppointment",
      default: null,
      index: true,
    },

    title: { type: String, trim: true, required: true, maxlength: 300 },
    procedureName: { type: String, trim: true, required: true, maxlength: 300 },
    /** Дата процедуры — точка отсчёта для всех сроков. */
    procedureAt: { type: Date, required: true },

    steps: { type: [assignedStepSchema], required: true },

    assignedByMembershipId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClinicMembership",
      default: null,
    },
    cancelledAt: { type: Date, default: null },
  },
  { timestamps: true },
);

videoPlaylistAssignmentSchema.index({ patientUserId: 1, procedureAt: -1 });
videoPlaylistAssignmentSchema.index({ clinicId: 1, clinicPatientId: 1, procedureAt: -1 });

/**
 * Готовность к процедуре одним числом — то, что видит врач в списке.
 *
 * Считаются только обязательные шаги: необязательный ролик «как всё
 * устроено» не должен превращать подготовленного пациента в
 * неподготовленного.
 */
videoPlaylistAssignmentSchema.virtual("progress").get(function () {
  const обязательные = (this.steps || []).filter((ш) => ш.required);
  if (!обязательные.length) return { done: 0, total: 0, ready: true };
  const сделано = обязательные.filter((ш) => ш.completedAt).length;
  return {
    done: сделано,
    total: обязательные.length,
    ready: сделано === обязательные.length,
  };
});

videoPlaylistAssignmentSchema.set("toJSON", { virtuals: true });
videoPlaylistAssignmentSchema.set("toObject", { virtuals: true });

export const VideoPlaylist =
  mongoose.models.VideoPlaylist ||
  mongoose.model("VideoPlaylist", videoPlaylistSchema);

export const VideoPlaylistAssignment =
  mongoose.models.VideoPlaylistAssignment ||
  mongoose.model("VideoPlaylistAssignment", videoPlaylistAssignmentSchema);

export default VideoPlaylist;
