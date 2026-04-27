// server/modules/simulation/validators/simulationPlan.validator.js
import Joi from "joi";

/* ──────────────────────────────────────────────────────────────────────────
   Лимиты. Менять здесь, а не по всему коду.
   MAX_CONTROL_POINTS — мягкий потолок. В ТЗ сказано "30+ без лимита",
   но совсем без потолка API открыт для abuse (один запрос на 100k точек
   положит worker). 200 — более чем достаточно для реальных сценариев.
   ────────────────────────────────────────────────────────────────────────── */
const MAX_LABEL_LEN = 200;
const MAX_PATIENT_REF_LEN = 200;
const MAX_CONTROL_POINTS = 200;
const MAX_POINT_KEY_LEN = 64;

/* ──────────────────────────────────────────────────────────────────────────
   ObjectId helper — Mongo _id как строка из URL/body.
   Принимаем 24-символьный hex. Конвертация в ObjectId — в сервисном слое.
   ────────────────────────────────────────────────────────────────────────── */
const objectIdPattern = /^[0-9a-fA-F]{24}$/;

const objectIdSchema = Joi.string().pattern(objectIdPattern).messages({
  "string.pattern.base": "{#label} must be a 24-character hex ObjectId",
});

/* ──────────────────────────────────────────────────────────────────────────
   Control point. Координаты и параметры в нормализованном [0..1] / [-1..1]
   пространстве — разрешение-независимо, одни значения работают на preview
   1200px и на full-res export.
   ────────────────────────────────────────────────────────────────────────── */
const controlPointSchema = Joi.object({
  key: Joi.string().trim().min(1).max(MAX_POINT_KEY_LEN).required(),

  anchor: Joi.object({
    x: Joi.number().min(0).max(1).required(),
    y: Joi.number().min(0).max(1).required(),
  }).required(),

  current: Joi.object({
    x: Joi.number().min(0).max(1).required(),
    y: Joi.number().min(0).max(1).required(),
  }).required(),

  radius: Joi.number().min(0.001).max(1).required(),
  strength: Joi.number().min(-1).max(1).required(),
});

/* ──────────────────────────────────────────────────────────────────────────
   Embedded photo. Используется ТОЛЬКО при create — upload-controller
   сначала кладёт файл в R2, получает этот объект, и прокидывает внутрь
   createPlan. Клиент напрямую не шлёт photo: фото приходит из upload-step.
   ────────────────────────────────────────────────────────────────────────── */
const embeddedPhotoSchema = Joi.object({
  r2Key: Joi.string().trim().min(1).max(500).required(),
  url: Joi.string()
    .uri({ scheme: ["http", "https"] })
    .required(),
  width: Joi.number().integer().min(1).max(20000).required(),
  height: Joi.number().integer().min(1).max(20000).required(),
  size: Joi.number().integer().min(0).required(),
  mimeType: Joi.string()
    .valid("image/jpeg", "image/png", "image/webp")
    .required(),
  uploadedAt: Joi.date().optional(), // проставит модель, если не пришло
});

/* ──────────────────────────────────────────────────────────────────────────
   CREATE — новый план. photo приходит из upload-шага (см. выше).
   ────────────────────────────────────────────────────────────────────────── */
export const createPlanSchema = Joi.object({
  label: Joi.string().trim().min(1).max(MAX_LABEL_LEN).required(),

  // Опциональная метка пациента — любая строка на усмотрение врача.
  patientRef: Joi.string()
    .trim()
    .max(MAX_PATIENT_REF_LEN)
    .allow("", null)
    .optional(),

  photo: embeddedPhotoSchema.required(),

  // При create обычно точек нет, но разрешаем (duplicate, import, etc.).
  controlPoints: Joi.array()
    .items(controlPointSchema)
    .max(MAX_CONTROL_POINTS)
    .default([]),
});

/* ──────────────────────────────────────────────────────────────────────────
   UPDATE — частичное. Любое подмножество полей, но не может быть пустым.
   photo и doctorId менять нельзя — это конструктивные свойства плана.
   Если врач хочет другое фото — делает новый план.
   ────────────────────────────────────────────────────────────────────────── */
export const updatePlanSchema = Joi.object({
  label: Joi.string().trim().min(1).max(MAX_LABEL_LEN).optional(),
  patientRef: Joi.string()
    .trim()
    .max(MAX_PATIENT_REF_LEN)
    .allow("", null)
    .optional(),

  controlPoints: Joi.array()
    .items(controlPointSchema)
    .max(MAX_CONTROL_POINTS)
    .optional(),
})
  .min(1)
  .messages({
    "object.min": "At least one field must be provided",
  });

/* ──────────────────────────────────────────────────────────────────────────
   LIST query — пагинация + поиск. Все поля опциональны, разумные defaults.
   Поиск по label не поддерживаем — поле зашифровано, full-text невозможен
   без дешифровки всей коллекции. При нужде — отдельная task (S.5+).
   ────────────────────────────────────────────────────────────────────────── */
export const listPlansQuerySchema = Joi.object({
  limit: Joi.number().integer().min(1).max(100).default(30),
  cursor: Joi.string().pattern(objectIdPattern).optional(), // _id последнего плана из предыдущей страницы
  includeDeleted: Joi.boolean().default(false),
});

/* ──────────────────────────────────────────────────────────────────────────
   DUPLICATE — опциональный новый label (если не задан, сервис добавит
   суффикс "(copy)" к расшифрованному оригиналу).
   ────────────────────────────────────────────────────────────────────────── */
export const duplicatePlanSchema = Joi.object({
  label: Joi.string().trim().min(1).max(MAX_LABEL_LEN).optional(),
});

/* ──────────────────────────────────────────────────────────────────────────
   :id param — для любого роута с /:id.
   ────────────────────────────────────────────────────────────────────────── */
export const planIdParamSchema = Joi.object({
  id: objectIdSchema.required(),
});

/* ──────────────────────────────────────────────────────────────────────────
   Универсальная middleware-фабрика. Одна для всех роутов модуля.
   Usage:
     router.post('/', validate(createPlanSchema), createPlanController)
     router.get('/:id', validateParams(planIdParamSchema), getPlanController)
     router.get('/', validateQuery(listPlansQuerySchema), listPlansController)
   ────────────────────────────────────────────────────────────────────────── */
function buildValidator(source) {
  return (schema) => (req, res, next) => {
    const { value, error } = schema.validate(req[source], {
      abortEarly: false,
      stripUnknown: true,
      convert: true, // "30" → 30, "true" → true для query
    });

    if (error) {
      return res.status(400).json({
        error: "validation_error",
        details: error.details.map((d) => ({
          field: d.path.join("."),
          message: d.message,
        })),
      });
    }

    // Пишем обратно очищенное значение (важно для stripUnknown).
    req[source] = value;
    next();
  };
}

export const validate = buildValidator("body");
export const validateParams = buildValidator("params");
export const validateQuery = buildValidator("query");

// Экспорт лимитов для возможного переиспользования в UI.
export const limits = {
  MAX_LABEL_LEN,
  MAX_PATIENT_REF_LEN,
  MAX_CONTROL_POINTS,
  MAX_POINT_KEY_LEN,
};
