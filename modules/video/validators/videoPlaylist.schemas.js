// server/modules/video/validators/videoPlaylist.schemas.js
//
// Схемы планов подготовки.
//
// ЧЕГО ЗДЕСЬ НЕТ: полей прогресса. Отметку «шаг сделан» ставит только учёт
// просмотра — принимать её телом запроса значило бы позволить объявить
// пациента подготовленным, не показав ему ни одного ролика.

import { z } from "zod";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Некорректный идентификатор");

const stepSchema = z.object({
  videoId: objectId,
  // 90 дней — предел осмысленного: подготовка, начатая за квартал,
  // забывается раньше, чем наступает процедура.
  offsetDays: z.number().int().min(0).max(90),
  required: z.boolean().optional(),
  note: z.string().trim().max(500).optional(),
});

export const createPlaylistSchema = z.object({
  title: z.string().trim().min(1).max(300),
  procedureName: z.string().trim().min(1).max(300),
  description: z.string().trim().max(2000).optional(),
  steps: z.array(stepSchema).min(1, "Нужен хотя бы один ролик").max(20),
});

export const assignPlaylistSchema = z.object({
  playlistId: objectId,
  clinicPatientId: objectId,
  patientUserId: objectId,
  appointmentId: objectId.optional(),
  procedureAt: z.string().datetime({ offset: true }).or(z.string().datetime()),
});

export default { createPlaylistSchema, assignPlaylistSchema };
