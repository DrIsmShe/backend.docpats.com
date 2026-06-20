// server/modules/clinic/clinic-announcements/validators/announcement.schemas.js
//
// Zod schemas for ClinicAnnouncement endpoints. Mirrors knowledge.schemas.js.

import { z } from "zod";

export const createAnnouncementSchema = z.object({
  title: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(20000),
  audience: z.enum(["all", "department"]).optional().default("all"),
  departmentId: z.string().trim().optional().nullable(),
  pinned: z.boolean().optional().default(false),
});

export const listAnnouncementsQuerySchema = z.object({
  status: z.enum(["published", "archived"]).optional(),
  departmentId: z.string().trim().optional(),
  includeArchived: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => v === true || v === "true"),
});

export const setPinnedSchema = z.object({
  pinned: z.boolean(),
});
