import { z } from "zod";

const PRESET_TYPES = ["rhinoplasty_lateral"];
// На будущее добавим больше presets

const LandmarkSchema = z.object({
  id: z.string().min(1),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  confidence: z.enum(["manual", "auto", "corrected", "ai_detected"]).optional(),
});

/* ============================================================
   POST /photos/:photoId/annotations (создание v1)
   ============================================================ */
export const createAnnotationSchema = z.object({
  presetType: z.enum(PRESET_TYPES),
  landmarks: z.array(LandmarkSchema).min(1).max(50),
  description: z.string().max(2000).optional(),
});

/* ============================================================
   GET /photos/:photoId/annotations/current (query)
   GET /photos/:photoId/annotations/history (query)
   ============================================================ */
export const annotationByPresetQuerySchema = z.object({
  presetType: z.enum(PRESET_TYPES),
});

/* ============================================================
   PATCH /annotations/:annotationId
   ============================================================ */
export const updateLandmarksSchema = z.object({
  landmarks: z.array(LandmarkSchema).min(1).max(50),
});

/* ============================================================
   POST /photos/:photoId/annotations/version (новая версия)
   ============================================================ */
export const createNewVersionSchema = z.object({
  presetType: z.enum(PRESET_TYPES),
  landmarks: z.array(LandmarkSchema).min(1).max(50),
  description: z.string().max(2000).optional(),
});

/* ============================================================
   POST /annotations/:annotationId/lock
   ============================================================ */
export const lockAnnotationSchema = z.object({
  reason: z.string().max(500).optional(),
});

/* ============================================================
   POST /annotations/:annotationId/unlock
   ============================================================ */
export const unlockAnnotationSchema = z.object({
  reason: z.string().min(10).max(500),
});

/* ============================================================
   DELETE /annotations/:annotationId
   ============================================================ */
export const deleteAnnotationSchema = z.object({
  reason: z.string().min(10).max(500),
});
