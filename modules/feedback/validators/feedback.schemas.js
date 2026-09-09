// server/modules/feedback/validators/feedback.schemas.js
//
// Схемы запросов обратной связи. Zod — как в остальных модулях.
//
// ПРЕДЕЛЫ ДЛИНЫ СОВПАДАЮТ С МОДЕЛЬЮ НАМЕРЕННО. Расхождение означало бы, что
// человек пишет длинный текст, проходит проверку и получает ошибку базы уже
// после нажатия «отправить» — потеряв написанное.
//
// ЗДЕСЬ НЕТ ПОЛЕЙ status, priority И resolution В СХЕМЕ СОЗДАНИЯ. Состояние
// назначает разбор, а не отправитель: иначе обращение можно было бы создать
// сразу «сделанным» и оно не попало бы в очередь.

import { z } from "zod";
import { ВИДЫ, РАЗДЕЛЫ, СОСТОЯНИЯ, ВАЖНОСТЬ } from "../models/feedback.model.js";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Некорректный идентификатор");

export const createFeedbackSchema = z.object({
  kind: z.enum(ВИДЫ),
  area: z.enum(РАЗДЕЛЫ).optional(),
  subject: z.string().trim().min(3, "Тема слишком короткая").max(140),
  body: z.string().trim().min(10, "Опишите подробнее — так мы поймём быстрее").max(5000),
  locale: z.enum(["ru", "en", "az", "tr", "ar"]).optional(),
  /* Адрес страницы, с которой пишут. Присылает клиент: серверный Referer
     до сюда не доходит — обращение уходит из одностраничного приложения. */
  url: z.string().trim().max(500).optional(),
  viewport: z.string().trim().max(20).optional(),
});

export const replySchema = z.object({
  text: z.string().trim().min(1, "Пустое сообщение отправить нельзя").max(4000),
});

/* Ответ администратора: либо свой текст, либо заготовка. Требовать хотя бы
   одно — работа схемы, а не контроллера: пустой ответ не должен доходить
   до сервиса вовсе. */
export const adminReplySchema = z
  .object({
    text: z.string().trim().max(4000).optional(),
    templateKey: z.string().trim().max(40).optional(),
  })
  .refine((v) => Boolean(v.text?.trim() || v.templateKey), {
    message: "Нужен текст ответа или заготовка",
  });

export const statusSchema = z.object({
  status: z.enum(СОСТОЯНИЯ),
  resolution: z.string().trim().max(2000).optional(),
  priority: z.enum(ВАЖНОСТЬ).optional(),
  /* Приписку сервера можно отключить: иногда администратор уже всё сказал
     своими словами, и казённая строка следом только портит ответ. */
  autoReply: z.boolean().optional(),
});

export const listQuerySchema = z.object({
  status: z.enum(СОСТОЯНИЯ).optional(),
  kind: z.enum(ВИДЫ).optional(),
  area: z.enum(РАЗДЕЛЫ).optional(),
  waiting: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const idParamSchema = z.object({ id: objectId });

export default {
  createFeedbackSchema,
  replySchema,
  adminReplySchema,
  statusSchema,
  listQuerySchema,
  idParamSchema,
};
