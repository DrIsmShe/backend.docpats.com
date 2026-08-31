// server/modules/surgicalPlan/controllers/surgicalPlan.controller.js

import { asyncHandler } from "../../../common/middlewares/errorHandler.js";
import { ValidationError } from "../../../common/utils/errors.js";
import { getCatalog, PROCEDURE_CODES } from "../catalog/index.js";
import { parsePrompt } from "../services/planParser.service.js";
import { getPlanSchema } from "../services/planSchema.service.js";
import { validatePlan } from "../services/planValidator.service.js";
import { tReq } from "../../../common/i18n/index.js";

/* ============================================================
   POST /api/surgical-plan/parse
   ============================================================
   Промт врача → разобранный план + вердикт валидации.

   План НЕ сохраняется. Это осознанно: план по фото пациента —
   это PHI, а для surgery-домена в проекте свой контур (AES-GCM
   на SURGERY_ENCRYPTION_KEY, отдельный аудит). Пока прототип
   проверяет качество разбора, ему незачем открывать хранилище;
   врач получает результат и решает, годится ли он.
   ============================================================ */
export const parse = asyncHandler(async (req, res) => {
  const { procedureCode, prompt, measurements, patientGender } = req.body;

  const { plan, meta } = await parsePrompt({
    procedureCode,
    prompt,
    measurements,
    patientGender,
  });

  const { catalog, preset } = getCatalog(procedureCode);

  const validation = validatePlan({
    plan,
    catalog,
    preset,
    measurements,
    patientGender,
  });

  res.json({ success: true, plan, validation, meta });
});

/* ============================================================
   POST /api/surgical-plan/validate
   ============================================================
   Пересчёт уже разобранного плана после правок ползунками.
   Модель не вызывается — значит, ни денег, ни задержки, и
   таблица «до/после» может обновляться на каждое движение.

   Клинические правила остаются на сервере в одном экземпляре:
   продублируй их на клиенте ради «мгновенности» — и рано или
   поздно браузер покажет один вердикт, а отчёт другой.
   ============================================================ */
export const validate = asyncHandler(async (req, res) => {
  const { procedureCode, plan, measurements, patientGender } = req.body;

  const { catalog, preset } = getCatalog(procedureCode);

  // План правил клиент, поэтому доверять его форме нельзя — гоним
  // через ту же схему, которой проверяется ответ модели.
  const parsed = getPlanSchema(catalog).safeParse(plan);
  if (!parsed.success) {
    const fields = {};
    for (const issue of parsed.error.issues) {
      fields[issue.path.join(".") || "_root"] = issue.message;
    }
    throw new ValidationError(tReq(req, "app.plan.catalogSchemaMismatch"), { fields });
  }

  const validation = validatePlan({
    plan: parsed.data,
    catalog,
    preset,
    measurements,
    patientGender,
  });

  res.json({ success: true, plan: parsed.data, validation });
});

/* ============================================================
   GET /api/surgical-plan/catalog/:procedureCode
   ============================================================
   Каталог для интерфейса. Фронт строит по нему ползунки, поэтому
   отдаём границы и подписи — врач правит план параметрами, а не
   переписыванием промта. Модель участвует один раз на входе.
   ============================================================ */
export const catalog = asyncHandler(async (req, res) => {
  const { catalog: cat, preset } = getCatalog(req.params.procedureCode);

  res.json({
    success: true,
    procedure: cat.meta,
    operations: cat.operations.map((op) => ({
      code: op.code,
      label: op.label,
      description: op.description,
      params: op.params,
      conflictsWith: op.conflictsWith,
    })),
    measurements: preset.measurements.map((m) => ({
      code: m.code,
      label: m.label,
      unit: m.unit,
      type: m.type,
      norm: m.norm ?? null,
      normByGender: m.normByGender ?? null,
    })),
  });
});

/* ============================================================
   GET /api/surgical-plan/procedures
   ============================================================ */
export const procedures = asyncHandler(async (_req, res) => {
  res.json({
    success: true,
    procedures: PROCEDURE_CODES.map((code) => getCatalog(code).catalog.meta),
  });
});
