// server/modules/surgicalPlan/validators/parsePlan.validator.js

import { z } from "zod";

import { PROCEDURE_CODES } from "../catalog/index.js";

/* ============================================================
   ВАЛИДАЦИЯ ЗАПРОСА НА РАЗБОР ПЛАНА
   ============================================================
   Фото здесь намеренно НЕ принимается, хотя разбор его умеет.
   Снимок пациента, уходящий стороннему провайдеру, — это вопрос
   BAA, а не удобства API. Пока договор не покрывает такую
   передачу, канал приёма фото просто не открыт: закрытый путь
   надёжнее включённого по умолчанию флага.

   Измерения приходят готовыми числами из модуля anthropometry
   (мм и градусы после калибровки), а не пикселями.
   ============================================================ */

/* ============================================================
   ВАЛИДАЦИЯ ЗАПРОСА НА ПЕРЕВАЛИДАЦИЮ ПРАВЛЕНОГО ПЛАНА
   ============================================================
   Врач двигает ползунок — план надо пересчитать. Сам план здесь
   проходит только как объект: его настоящая схема зависит от
   процедуры и строится из каталога, поэтому проверяется в
   контроллере, где код процедуры уже известен.

   Клинические правила при этом не дублируются на клиенте.
   Живи они в двух местах, они бы разошлись, и врач видел бы в
   браузере один вердикт, а в отчёте — другой.
   ============================================================ */
export const validatePlanRequestSchema = z
  .object({
    procedureCode: z.enum(PROCEDURE_CODES),
    plan: z.object({}).passthrough(),
    measurements: z
      .record(z.string(), z.number().finite())
      .nullable()
      .optional()
      .default(null),
    patientGender: z
      .enum(["male", "female", "other", "unknown"])
      .optional()
      .default("unknown"),
  })
  .strict();

export const parsePlanSchema = z
  .object({
    procedureCode: z.enum(PROCEDURE_CODES),

    // Верхняя граница — защита от вставки истории болезни целиком:
    // разбирается запрос на изменение, а не анамнез.
    prompt: z.string().trim().min(3).max(4000),

    measurements: z
      .record(z.string(), z.number().finite())
      .nullable()
      .optional()
      .default(null),

    patientGender: z
      .enum(["male", "female", "other", "unknown"])
      .optional()
      .default("unknown"),
  })
  .strict();

export default parsePlanSchema;
