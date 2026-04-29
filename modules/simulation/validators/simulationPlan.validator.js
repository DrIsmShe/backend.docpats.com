// server/modules/simulation/validators/simulationPlan.validator.js
import Joi from "joi";

/* ──────────────────────────────────────────────────────────────────────────
   Лимиты.
   ────────────────────────────────────────────────────────────────────────── */
const MAX_LABEL_LEN = 200;
const MAX_PATIENT_REF_LEN = 200;
const MAX_CONTROL_POINTS = 200;
const MAX_POINT_KEY_LEN = 64;

const objectIdPattern = /^[0-9a-fA-F]{24}$/;

const objectIdSchema = Joi.string().pattern(objectIdPattern).messages({
  "string.pattern.base": "{#label} must be a 24-character hex ObjectId",
});

/* ──────────────────────────────────────────────────────────────────────────
   Control point.
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
   S.7.7+ — Photo URL принимает И полные URL (https://...) И относительные
   пути (/api/simulation/photos/proxy?key=...).
   
   Раньше: Joi.string().uri({ scheme: ['http','https'] }) — только полные.
   Сейчас: просто Joi.string() с длиной до 2000 — допускает оба варианта.
   
   Безопасность: createPlanController всё равно перезаписывает url на
   canonical CDN URL через publicUrlFor(r2Key) перед сохранением в БД.
   То есть что бы клиент ни прислал в url — в БД попадёт правильное
   значение, построенное из r2Key (который мы валидируем строго).
   ────────────────────────────────────────────────────────────────────────── */
const embeddedPhotoSchema = Joi.object({
  r2Key: Joi.string().trim().min(1).max(500).required(),
  // S.7.7+ — допускаем относительный proxy URL и полный CDN URL
  url: Joi.string().trim().min(1).max(2000).required(),
  width: Joi.number().integer().min(1).max(20000).required(),
  height: Joi.number().integer().min(1).max(20000).required(),
  size: Joi.number().integer().min(0).required(),
  mimeType: Joi.string()
    .valid("image/jpeg", "image/png", "image/webp")
    .required(),
  uploadedAt: Joi.date().optional(),
});

/* ──────────────────────────────────────────────────────────────────────────
   CREATE
   ────────────────────────────────────────────────────────────────────────── */
export const createPlanSchema = Joi.object({
  label: Joi.string().trim().min(1).max(MAX_LABEL_LEN).required(),

  patientRef: Joi.string()
    .trim()
    .max(MAX_PATIENT_REF_LEN)
    .allow("", null)
    .optional(),

  photo: embeddedPhotoSchema.required(),

  controlPoints: Joi.array()
    .items(controlPointSchema)
    .max(MAX_CONTROL_POINTS)
    .default([]),
});

/* ──────────────────────────────────────────────────────────────────────────
   UPDATE
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
   LIST
   ────────────────────────────────────────────────────────────────────────── */
export const listPlansQuerySchema = Joi.object({
  limit: Joi.number().integer().min(1).max(100).default(30),
  cursor: Joi.string().pattern(objectIdPattern).optional(),
  includeDeleted: Joi.boolean().default(false),
});

/* ──────────────────────────────────────────────────────────────────────────
   DUPLICATE
   ────────────────────────────────────────────────────────────────────────── */
export const duplicatePlanSchema = Joi.object({
  label: Joi.string().trim().min(1).max(MAX_LABEL_LEN).optional(),
});

/* ──────────────────────────────────────────────────────────────────────────
   :id param
   ────────────────────────────────────────────────────────────────────────── */
export const planIdParamSchema = Joi.object({
  id: objectIdSchema.required(),
});

/* ──────────────────────────────────────────────────────────────────────────
   Universal validator middleware factory.
   ────────────────────────────────────────────────────────────────────────── */
function buildValidator(source) {
  return (schema) => (req, res, next) => {
    const { value, error } = schema.validate(req[source], {
      abortEarly: false,
      stripUnknown: true,
      convert: true,
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

    req[source] = value;
    next();
  };
}

export const validate = buildValidator("body");
export const validateParams = buildValidator("params");
export const validateQuery = buildValidator("query");

export const limits = {
  MAX_LABEL_LEN,
  MAX_PATIENT_REF_LEN,
  MAX_CONTROL_POINTS,
  MAX_POINT_KEY_LEN,
};
