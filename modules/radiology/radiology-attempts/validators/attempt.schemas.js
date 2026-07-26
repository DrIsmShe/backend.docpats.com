// server/modules/radiology/radiology-attempts/validators/attempt.schemas.js

import { z } from "zod";
import { ATTEMPT_MODES, FINDING_SHAPES } from "../../constants.js";
import { isKnownFinding } from "../../lexicon/lexicon.js";

const objectIdField = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid id");

function isUnit(n) {
  return typeof n === "number" && n >= 0 && n <= 1;
}

// Разметка учащегося: та же геометрия, что у эталона (см. case.schemas.js),
// но shape/coords лежат на верхнем уровне находки, а не под geometry.
const responseFindingSchema = z
  .object({
    imageIndex: z.number().int().min(0),
    label: z
      .string()
      .trim()
      .refine(isKnownFinding, { message: "Неизвестный ярлык находки" }),
    shape: z.enum(FINDING_SHAPES),
    coords: z.any(),
  })
  .superRefine((val, ctx) => {
    const c = val.coords ?? {};
    const bad = (message) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: ["coords"] });
    if (val.shape === "point") {
      if (!isUnit(c.x) || !isUnit(c.y)) bad("point требует {x,y} в 0..1");
    } else if (val.shape === "rect") {
      if (!isUnit(c.x) || !isUnit(c.y) || !isUnit(c.w) || !isUnit(c.h))
        bad("rect требует {x,y,w,h} в 0..1");
    } else if (val.shape === "ellipse") {
      if (!isUnit(c.cx) || !isUnit(c.cy) || !isUnit(c.rx) || !isUnit(c.ry))
        bad("ellipse требует {cx,cy,rx,ry} в 0..1");
    } else if (val.shape === "polygon") {
      const pts = c.points;
      if (!Array.isArray(pts) || pts.length < 3)
        bad("polygon требует {points:[{x,y}]} минимум из 3 точек");
      else if (!pts.every((p) => isUnit(p?.x) && isUnit(p?.y)))
        bad("все точки polygon должны быть {x,y} в 0..1");
    }
  });

export const startAttemptSchema = z.object({
  mode: z.enum(ATTEMPT_MODES).optional(),
});

export const policyQuerySchema = z.object({
  mode: z.enum(ATTEMPT_MODES).optional(),
});

// Сигналы добросовестности от клиента. Данные НЕ доверенные (браузер можно
// научить присылать нули), поэтому это подсказка автору, а не доказательство,
// и на балл они не влияют — см. integrity.service.js.
export const integritySignalsSchema = z
  .object({
    pasteEvents: z.number().int().min(0).max(1000).optional(),
    pastedChars: z.number().int().min(0).max(1000000).optional(),
    hiddenMs: z.number().int().min(0).max(100000000).optional(),
    focusLosses: z.number().int().min(0).max(10000).optional(),
  })
  .optional();

export const submitAttemptSchema = z.object({
  findings: z.array(responseFindingSchema).max(50).optional(),
  reviewedChecklist: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
  impressionText: z.string().trim().max(4000).optional(),
  // Ключи от учащегося: клиент присылает и фразу целиком, и отдельные слова.
  // 400 вместо 120 — развёрнутая клиническая формулировка («…активная стадия
  // (DAS28 > 5,1), эрозивная форма, II рентгенологическая стадия…») длиннее
  // 120 символов, и раньше сдача падала в 400, теряя ответ.
  diagnosisKeys: z.array(z.string().trim().min(1).max(400)).max(40).optional(),
  // Формулировка целиком — по ней диагноз и оценивается (diagnosisMatcher).
  diagnosisText: z.string().trim().max(4000).optional(),
  integrity: integritySignalsSchema,
});

export const listAttemptsQuerySchema = z.object({
  caseId: objectIdField.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
