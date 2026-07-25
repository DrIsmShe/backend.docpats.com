// server/modules/radiology/audit/radiologyEvent.model.js
//
// Доменный аудит модуля лучевой диагностики. Своя коллекция — намеренно,
// как у anthropometry и DoctorVerification: события «кто создал/опубликовал
// кейс», «кто сдал попытку» специфичны и не смешиваются с общим
// hipaa_audit_logs.
//
// ВАЖНО: в metadata — только структурные данные (ключи, счётчики, флаги),
// НИКОГДА не содержимое снимка и не персональные данные. Здесь их и нет,
// но правило держим то же, что в audit-модуле проекта.

import mongoose from "mongoose";

const { Schema } = mongoose;

const radiologyEventSchema = new Schema(
  {
    action: { type: String, required: true, index: true }, // case.create, case.publish, attempt.submit …
    actorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    actorRole: { type: String, default: null },
    caseId: { type: Schema.Types.ObjectId, ref: "RadiologyCase", default: null },
    attemptId: {
      type: Schema.Types.ObjectId,
      ref: "RadiologyAttempt",
      default: null,
    },
    metadata: { type: Schema.Types.Mixed, default: {} }, // только структурное
    createdAt: { type: Date, default: Date.now },
  },
  { collection: "radiology_events" },
);

radiologyEventSchema.index({ caseId: 1, createdAt: -1 });

const RadiologyEvent =
  mongoose.models.RadiologyEvent ||
  mongoose.model("RadiologyEvent", radiologyEventSchema, "radiology_events");

export default RadiologyEvent;
