// server/modules/video/controllers/videoPlaylist.controller.js
//
// HTTP-обёртки планов подготовки. Актёр — тот же buildActor каталога.

import { asyncHandler } from "../../../common/middlewares/errorHandler.js";
import { ValidationError } from "../../../common/utils/errors.js";
import { buildActor } from "./video.controller.js";
import * as service from "../services/videoPlaylist.service.js";
import {
  createPlaylistSchema,
  assignPlaylistSchema,
} from "../validators/videoPlaylist.schemas.js";

function throwZod(parsed) {
  throw new ValidationError("Validation failed", {
    issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
  });
}

export const createPlaylistController = asyncHandler(async (req, res) => {
  const parsed = createPlaylistSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);
  const playlist = await service.createPlaylist({
    actor: buildActor(req),
    data: parsed.data,
  });
  res.status(201).json({ playlist });
});

export const listPlaylistsController = asyncHandler(async (req, res) => {
  const { items } = await service.listPlaylists({ actor: buildActor(req) });
  res.json({ items, count: items.length });
});

export const deactivatePlaylistController = asyncHandler(async (req, res) => {
  const playlist = await service.deactivatePlaylist({
    actor: buildActor(req),
    id: req.params.id,
  });
  res.json({ playlist });
});

export const assignPlaylistController = asyncHandler(async (req, res) => {
  const parsed = assignPlaylistSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);
  const assignment = await service.assignPlaylist({
    actor: buildActor(req),
    data: parsed.data,
  });
  res.status(201).json({ assignment });
});

/** Кабинет пациента: что посмотреть и к какому сроку. */
export const listMyAssignmentsController = asyncHandler(async (req, res) => {
  const { items } = await service.listMyAssignments({ actor: buildActor(req) });
  res.json({ items, count: items.length });
});

export const listPatientAssignmentsController = asyncHandler(async (req, res) => {
  const { items } = await service.listPatientAssignments({
    actor: buildActor(req),
    clinicPatientId: req.params.clinicPatientId,
  });
  res.json({ items, count: items.length });
});

/** Готов ли тот, кто придёт на этот приём. */
export const listAppointmentAssignmentsController = asyncHandler(async (req, res) => {
  const { items } = await service.listAppointmentAssignments({
    actor: buildActor(req),
    appointmentId: req.params.appointmentId,
  });
  res.json({ items, count: items.length });
});

export const cancelAssignmentController = asyncHandler(async (req, res) => {
  const assignment = await service.cancelAssignment({
    actor: buildActor(req),
    id: req.params.id,
  });
  res.json({ assignment });
});
