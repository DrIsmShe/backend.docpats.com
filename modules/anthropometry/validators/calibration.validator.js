import { z } from "zod";
import { ObjectIdSchema, Point2DSchema } from "./_shared.js";

/* ============================================================
   POST /studies/:studyId/calibrate/ruler
   ============================================================ */
export const calibrateRulerSchema = z.object({
  referencePhotoId: ObjectIdSchema,
  point1: Point2DSchema,
  point2: Point2DSchema,
  knownDistanceMm: z.number().positive().max(500),
});

/* ============================================================
   POST /studies/:studyId/calibrate/interpupillary
   ============================================================ */
export const calibrateInterpupillarySchema = z.object({
  referencePhotoId: ObjectIdSchema,
  leftPupil: Point2DSchema,
  rightPupil: Point2DSchema,
  patientGender: z.enum(["male", "female", "other", "unknown"]).optional(),
  assumedDistanceMm: z.number().positive().min(40).max(80).optional(),
});

/* ============================================================
   POST /studies/:studyId/recalibrate
   ============================================================ */
export const recalibrateSchema = z
  .object({
    method: z.enum(["ruler", "interpupillary"]),
    data: z.record(z.string(), z.any()),
  })
  .refine(
    (input) => {
      if (input.method === "ruler") {
        return (
          input.data.referencePhotoId &&
          input.data.point1 &&
          input.data.point2 &&
          typeof input.data.knownDistanceMm === "number"
        );
      }
      return (
        input.data.referencePhotoId &&
        input.data.leftPupil &&
        input.data.rightPupil
      );
    },
    { message: "data must match the structure for the chosen method" },
  );
