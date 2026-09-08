// server/modules/video/validators/videoConsent.schemas.js
//
// Схемы видео-согласия.
//
// ЧЕГО ЗДЕСЬ НЕТ НАМЕРЕННО: полей watch, status и signedAt. Прогресс
// просмотра ставится только учётом просмотра, статус выводится из него, а
// подпись — отдельное действие пациента. Принимать их телом запроса значило
// бы позволить подписать согласие, не открывая ролик.

import { z } from "zod";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Некорректный идентификатор");

export const requestConsentSchema = z.object({
  videoId: objectId,
  clinicPatientId: objectId,
  patientUserId: objectId,
  appointmentId: objectId.optional(),
  procedureName: z.string().trim().min(1, "Укажите вмешательство").max(300),
  // 0 — бессрочно. Верхняя граница в год: согласие, данное давно и под
  // другой ролик, юридически сомнительно.
  expiresInDays: z.number().int().min(0).max(365).optional(),
});

export const revokeConsentSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export const listConsentsQuerySchema = z.object({
  status: z
    .enum(["pending", "watched", "signed", "revoked", "expired"])
    .optional(),
});

export default {
  requestConsentSchema,
  revokeConsentSchema,
  listConsentsQuerySchema,
};
