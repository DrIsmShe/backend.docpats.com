// server/modules/simulation/validators/simulationPlan.validator.js

import Joi from "joi";

const MAX_LABEL_LEN = 200;
const MAX_PATIENT_REF_LEN = 200;
const MAX_CONTROL_POINTS = 500;
const MAX_POINT_KEY_LEN = 64;

const objectIdPattern = /^[0-9a-fA-F]{24}$/;

const objectIdSchema = Joi.string().pattern(objectIdPattern).messages({
  "string.pattern.base": "{#label} must be a 24-character hex ObjectId",
});

/* ──────────────────────────────────────────────────────────────────────
   Phase Б.2 v3 — Control point schema с .unknown(true) для будущих полей
   (label, auto, side, и т.д.)
   ────────────────────────────────────────────────────────────────────── */
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
}).unknown(true);

const embeddedPhotoSchema = Joi.object({
  r2Key: Joi.string().trim().min(1).max(500).required(),
  url: Joi.string().trim().min(1).max(2000).required(),
  width: Joi.number().integer().min(1).max(20000).required(),
  height: Joi.number().integer().min(1).max(20000).required(),
  size: Joi.number().integer().min(0).required(),
  mimeType: Joi.string()
    .valid("image/jpeg", "image/png", "image/webp")
    .required(),
  uploadedAt: Joi.date().optional(),
});

const BREAST_PHOTO_VIEWS = [
  "front",
  "side_left",
  "side_right",
  "oblique_left",
  "oblique_right",
  "bottom_up",
];

const BREAST_OPERATION_TYPES = [
  "augmentation",
  "reduction",
  "mastopexy",
  "asymmetry",
];

const point2D = Joi.object({
  x: Joi.number().min(0).max(1).allow(null).required(),
  y: Joi.number().min(0).max(1).allow(null).required(),
});

const pointArray = (maxLen = 12) =>
  Joi.array().items(point2D).max(maxLen).default([]);

const breastAnatomySchema = Joi.object({
  sternalNotch: point2D.allow(null),
  midline: point2D.allow(null),
  leftNipple: point2D.allow(null),
  rightNipple: point2D.allow(null),
  leftIMF: pointArray(20),
  rightIMF: pointArray(20),
  leftAreolaEdge: pointArray(20),
  rightAreolaEdge: pointArray(20),
  nipple: point2D.allow(null),
  imfPoint: point2D.allow(null),
  breastUpperPole: point2D.allow(null),
  chestWallLine: pointArray(20),
})
  .unknown(true)
  .default({});

const breastOperationParamsSchema = Joi.object()
  .pattern(
    /^[a-zA-Z][a-zA-Z0-9_]*$/,
    Joi.alternatives().try(
      Joi.number(),
      Joi.string().max(100),
      Joi.boolean(),
      Joi.allow(null),
    ),
  )
  .unknown(true)
  .default({});

const breastOperationSchema = Joi.object({
  type: Joi.string()
    .valid(...BREAST_OPERATION_TYPES)
    .allow(null)
    .default(null),
  params: breastOperationParamsSchema,
  enabled: Joi.boolean().default(true),
})
  .unknown(true)
  .default({ type: null, params: {}, enabled: false });

const calibrationSchema = Joi.object({
  knownDistanceMm: Joi.number().min(1).max(2000).allow(null).default(null),
  p1: point2D.allow(null).default(null),
  p2: point2D.allow(null).default(null),
  referenceLabel: Joi.string().allow("").max(100).default(""),
})
  .unknown(true)
  .default({});

export const createPlanSchema = Joi.object({
  planType: Joi.string().valid("face").default("face"),
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

export const createBreastPlanSchema = Joi.object({
  planType: Joi.string().valid("breast").required(),
  label: Joi.string().trim().min(1).max(MAX_LABEL_LEN).required(),
  patientRef: Joi.string()
    .trim()
    .max(MAX_PATIENT_REF_LEN)
    .allow("", null)
    .optional(),
  photo: embeddedPhotoSchema.required(),
  photoView: Joi.string()
    .valid(...BREAST_PHOTO_VIEWS)
    .required(),
  anatomy: breastAnatomySchema,
  operation: breastOperationSchema,
  calibration: calibrationSchema,
  controlPoints: Joi.array()
    .items(controlPointSchema)
    .max(MAX_CONTROL_POINTS)
    .default([]),
});

export const createPlanUniversalSchema = Joi.alternatives().conditional(
  ".planType",
  {
    is: "breast",
    then: createBreastPlanSchema,
    otherwise: createPlanSchema,
  },
);

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
  anatomy: breastAnatomySchema.optional(),
  operation: breastOperationSchema.optional(),
  calibration: calibrationSchema.optional(),
})
  .min(1)
  .messages({
    "object.min": "At least one field must be provided",
  });

export const listPlansQuerySchema = Joi.object({
  limit: Joi.number().integer().min(1).max(100).default(30),
  cursor: Joi.string().pattern(objectIdPattern).optional(),
  includeDeleted: Joi.boolean().default(false),
  planType: Joi.string().valid("face", "breast").optional(),
});

export const duplicatePlanSchema = Joi.object({
  label: Joi.string().trim().min(1).max(MAX_LABEL_LEN).optional(),
});

export const planIdParamSchema = Joi.object({
  id: objectIdSchema.required(),
});

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

export const breastConstants = {
  PHOTO_VIEWS: BREAST_PHOTO_VIEWS,
  OPERATION_TYPES: BREAST_OPERATION_TYPES,
};
