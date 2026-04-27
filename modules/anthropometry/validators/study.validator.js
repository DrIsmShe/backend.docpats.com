import { z } from "zod";

const STUDY_TYPES = [
  "pre_op",
  "post_op_1w",
  "post_op_1m",
  "post_op_3m",
  "post_op_6m",
  "post_op_1y",
  "follow_up",
  "simulation",
  "other",
];

/* ============================================================
   POST /cases/:caseId/studies
   ============================================================ */
export const createStudySchema = z.object({
  studyDate: z.coerce.date(),
  studyType: z.enum(STUDY_TYPES),
  notes: z.string().max(5000).optional(),
});

/* ============================================================
   PATCH /studies/:studyId
   ============================================================ */
export const updateStudySchema = z
  .object({
    studyDate: z.coerce.date().optional(),
    studyType: z.enum(STUDY_TYPES).optional(),
    notes: z.string().max(5000).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
  });

/* ============================================================
   GET /cases/:caseId/studies (query)
   ============================================================ */
export const listStudiesQuerySchema = z.object({
  includeArchived: z.coerce.boolean().optional(),
});

/* ============================================================
   DELETE /studies/:studyId
   ============================================================ */
export const deleteStudySchema = z.object({
  reason: z.string().min(10).max(500),
});
