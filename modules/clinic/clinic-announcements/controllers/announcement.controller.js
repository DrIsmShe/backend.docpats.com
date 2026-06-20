// server/modules/clinic/clinic-announcements/controllers/announcement.controller.js
//
// Thin HTTP controllers for ClinicAnnouncement. Same shape as
// clinic-knowledge / clinic-rooms controllers. clinicId + membershipId are
// read from tenantContext inside the service, so controllers stay minimal.

import { asyncHandler } from "../../../../common/middlewares/errorHandler.js";
import { ValidationError } from "../../../../common/utils/errors.js";
import {
  createAnnouncement,
  listAnnouncements,
  getAnnouncement,
  markRead,
  getReadReceipts,
  setPinned,
  archiveAnnouncement,
  unarchiveAnnouncement,
  deleteAnnouncement,
} from "../services/announcement.service.js";
import {
  createAnnouncementSchema,
  listAnnouncementsQuerySchema,
  setPinnedSchema,
} from "../validators/announcement.schemas.js";

function throwZod(parsed) {
  throw new ValidationError("Validation failed", {
    issues: parsed.error.issues.map((i) => ({
      path: i.path,
      message: i.message,
    })),
  });
}

export const createAnnouncementController = asyncHandler(async (req, res) => {
  const parsed = createAnnouncementSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);
  const announcement = await createAnnouncement({ body: parsed.data });
  res.status(201).json({ announcement });
});

export const listAnnouncementsController = asyncHandler(async (req, res) => {
  const parsed = listAnnouncementsQuerySchema.safeParse(req.query);
  if (!parsed.success) throwZod(parsed);
  const { items } = await listAnnouncements({ query: parsed.data });
  res.json({ items, count: items.length });
});

export const getAnnouncementController = asyncHandler(async (req, res) => {
  const announcement = await getAnnouncement({ id: req.params.id });
  res.json({ announcement });
});

export const markReadController = asyncHandler(async (req, res) => {
  const announcement = await markRead({ id: req.params.id });
  res.json({ announcement });
});

export const readReceiptsController = asyncHandler(async (req, res) => {
  const result = await getReadReceipts({ id: req.params.id });
  res.json(result); // { readCount, totalMembers, readers }
});

export const setPinnedController = asyncHandler(async (req, res) => {
  const parsed = setPinnedSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);
  const announcement = await setPinned({
    id: req.params.id,
    pinned: parsed.data.pinned,
  });
  res.json({ announcement });
});

export const archiveAnnouncementController = asyncHandler(async (req, res) => {
  const announcement = await archiveAnnouncement({ id: req.params.id });
  res.json({ announcement });
});
export const unarchiveAnnouncementController = asyncHandler(
  async (req, res) => {
    const announcement = await unarchiveAnnouncement({ id: req.params.id });
    res.json({ announcement });
  },
);
export const deleteAnnouncementController = asyncHandler(async (req, res) => {
  const result = await deleteAnnouncement({ id: req.params.id });
  res.json(result); // { announcementId, deleted: true }
});
