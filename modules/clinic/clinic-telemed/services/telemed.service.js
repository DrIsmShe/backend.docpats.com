// server/modules/clinic/clinic-telemed/services/telemed.service.js
//
// Business logic for TelemedSession.
//
// Conventions (mirrors the other clinic-* services):
//   - clinicId is ALWAYS an explicit argument (no ALS); tenant-scoped.
//   - NO requirePerm here — RBAC upstream + frontend.
//   - departmentId / hostMembershipId (optional) are validated for clinic
//     ownership. patientId is stored as-is (clinic-scoped reads protect it),
//     consistent with the consilium module.
//   - A unique opaque joinKey is generated on create; the existing call layer
//     consumes it as a room id.
//   - Status transitions stamp startedAt (→ live) and endedAt (→ a terminal
//     state) automatically.

import crypto from "node:crypto";
import mongoose from "mongoose";
import TelemedSession from "../models/telemedSession.model.js";
import {
  ValidationError,
  NotFoundError,
  ConflictError,
} from "../../../../common/utils/errors.js";
import logger from "../../../../common/logger.js";
import { encryptPHI, decryptFields } from "../../../../common/utils/phiCrypto.js";

const TERMINAL = new Set(["completed", "cancelled", "no_show"]);

// Поля PHI, которые шифруются в этой модели. title НЕ шифруется — по нему идёт
// regex-поиск (listSessions), а по шифртексту regex невозможен.
const PHI_FIELDS = ["notes"];
const decrypt = (doc) => decryptFields(doc, PHI_FIELDS);

// ─── helpers ──────────────────────────────────────────────────────────

function generateJoinKey() {
  // URL-safe, collision-resistant opaque token.
  return crypto.randomBytes(18).toString("base64url");
}

// Base URL of the video room provider. Override in prod via env, e.g.
//   TELEMED_MEETING_BASE=https://meet.docpats.com/docpats-
// when the self-hosted Jitsi is live. Default points at the public Jitsi
// for development/testing only — NOT for real PHI.
function meetingBase() {
  const raw =
    process.env.TELEMED_MEETING_BASE || "https://meet.jit.si/docpats-";
  return raw;
}

// Build a room link from a joinKey. The joinKey is URL-safe base64url, so it
// is appended directly. Returns a full https URL.
function buildMeetingUrl(joinKey) {
  return `${meetingBase()}${joinKey}`;
}

async function assertDepartmentOwnership(clinicId, departmentId) {
  if (!departmentId) return null;
  const { ClinicDepartment } =
    await import("../../clinic-departments/models/clinicDepartment.model.js");
  const dep = await ClinicDepartment.findOne({ _id: departmentId, clinicId })
    .select("_id")
    .lean();
  if (!dep) throw new ValidationError("departmentId not found in this clinic");
  return dep._id;
}

async function assertMembershipInClinic(clinicId, membershipId) {
  if (!membershipId) return null;
  const { default: ClinicMembership } =
    await import("../../clinic-staff/models/clinicMembership.model.js");
  const m = await ClinicMembership.findOne({ _id: membershipId, clinicId })
    .select("_id")
    .lean();
  if (!m) {
    throw new ValidationError(
      "hostMembershipId does not belong to this clinic",
    );
  }
  return m._id;
}

function toConflictIfDupKey(err) {
  if (err && err.code === 11000) {
    return new ConflictError("joinKey collision, please retry");
  }
  return err;
}

// ─── createSession ─────────────────────────────────────────────────────
export async function createSession(clinicId, input) {
  if (!clinicId) throw new ValidationError("clinicId is required");

  const departmentId = await assertDepartmentOwnership(
    clinicId,
    input.departmentId,
  );
  const hostMembershipId = await assertMembershipInClinic(
    clinicId,
    input.hostMembershipId,
  );

  const scheduledAt = new Date(input.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime())) {
    throw new ValidationError("scheduledAt is not a valid date");
  }

  const joinKey = generateJoinKey();

  // Resolve the video method (Option 1 priority):
  //   1. manual meetingUrl  → keep it (respect the doctor's choice)
  //   2. patientUserId set  → leave meetingUrl null (native call will be used)
  //   3. neither            → auto-generate a room link from the joinKey
  let meetingUrl = input.meetingUrl ?? null;
  if (!meetingUrl && !input.patientUserId) {
    meetingUrl = buildMeetingUrl(joinKey);
  }

  try {
    const doc = await TelemedSession.create({
      clinicId,
      patientId: input.patientId ?? null,
      hostMembershipId,
      departmentId,
      title: input.title,
      scheduledAt,
      durationMinutes: input.durationMinutes ?? 30,
      status: "scheduled",
      joinKey,
      meetingUrl,
      patientUserId: input.patientUserId ?? null,
      notes: encryptPHI(input.notes ?? null),
      createdBy: input.actorId ?? null,
    });
    return decrypt(doc.toObject());
  } catch (err) {
    throw toConflictIfDupKey(err);
  }
}

// ─── listSessions ─────────────────────────────────────────────────────
export async function listSessions(clinicId, filters = {}) {
  if (!clinicId) throw new ValidationError("clinicId is required");

  const query = { clinicId };
  if (filters.status) query.status = filters.status;
  if (filters.patientId) query.patientId = filters.patientId;
  if (filters.hostMembershipId)
    query.hostMembershipId = filters.hostMembershipId;
  if (filters.departmentId) query.departmentId = filters.departmentId;

  if (filters.from || filters.to) {
    query.scheduledAt = {};
    if (filters.from) {
      const d = new Date(filters.from);
      if (!Number.isNaN(d.getTime())) query.scheduledAt.$gte = d;
    }
    if (filters.to) {
      const d = new Date(filters.to);
      if (!Number.isNaN(d.getTime())) query.scheduledAt.$lte = d;
    }
    if (Object.keys(query.scheduledAt).length === 0) delete query.scheduledAt;
  }

  if (filters.q && filters.q.trim()) {
    const safe = filters.q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    query.title = new RegExp(safe, "i");
  }

  // Soonest first.
  const docs = await TelemedSession.find(query).sort({ scheduledAt: 1 }).lean();
  return docs.map(decrypt);
}

// ─── getSessionById ─────────────────────────────────────────────────────
export async function getSessionById(clinicId, id) {
  if (!clinicId) throw new ValidationError("clinicId is required");
  const doc = await TelemedSession.findOne({ _id: id, clinicId }).lean();
  if (!doc) throw new NotFoundError("Telemed session not found");
  return decrypt(doc);
}

// ─── updateSession ─────────────────────────────────────────────────────
export async function updateSession(clinicId, id, input) {
  if (!clinicId) throw new ValidationError("clinicId is required");

  const existing = await TelemedSession.findOne({ _id: id, clinicId });
  if (!existing) throw new NotFoundError("Telemed session not found");

  const update = {};

  if (input.title !== undefined) update.title = input.title;
  if (input.notes !== undefined) update.notes = encryptPHI(input.notes ?? null);
  if (input.durationMinutes !== undefined)
    update.durationMinutes = input.durationMinutes;
  if (input.patientId !== undefined) update.patientId = input.patientId ?? null;
  if (input.patientUserId !== undefined)
    update.patientUserId = input.patientUserId ?? null;
  if (input.meetingUrl !== undefined)
    update.meetingUrl = input.meetingUrl ?? null;
  if (input.actorId !== undefined) update.updatedBy = input.actorId;

  if (input.scheduledAt !== undefined) {
    const d = new Date(input.scheduledAt);
    if (Number.isNaN(d.getTime())) {
      throw new ValidationError("scheduledAt is not a valid date");
    }
    update.scheduledAt = d;
  }

  if (input.departmentId !== undefined) {
    update.departmentId = await assertDepartmentOwnership(
      clinicId,
      input.departmentId,
    );
  }
  if (input.hostMembershipId !== undefined) {
    update.hostMembershipId = await assertMembershipInClinic(
      clinicId,
      input.hostMembershipId,
    );
  }

  // Status transition + timestamp stamping.
  if (input.status !== undefined && input.status !== existing.status) {
    update.status = input.status;
    if (input.status === "live" && !existing.startedAt) {
      update.startedAt = new Date();
    }
    if (TERMINAL.has(input.status) && !existing.endedAt) {
      update.endedAt = new Date();
    }
  }

  // Keep a usable video method (Option 1): if, after this update, there is
  // neither a manual/auto meetingUrl nor a patientUserId, regenerate the room
  // link from the existing joinKey. Uses the resulting values (update wins
  // over existing for fields being changed).
  const resultingMeetingUrl =
    update.meetingUrl !== undefined ? update.meetingUrl : existing.meetingUrl;
  const resultingPatientUserId =
    update.patientUserId !== undefined
      ? update.patientUserId
      : existing.patientUserId;
  if (!resultingMeetingUrl && !resultingPatientUserId) {
    update.meetingUrl = buildMeetingUrl(existing.joinKey);
  }

  const doc = await TelemedSession.findOneAndUpdate(
    { _id: id, clinicId },
    { $set: update },
    { new: true, runValidators: true },
  ).lean();
  if (!doc) throw new NotFoundError("Telemed session not found");
  return decrypt(doc);
}

// ─── cancelSession (terminal → cancelled) ──────────────────────────────
export async function cancelSession(clinicId, id) {
  if (!clinicId) throw new ValidationError("clinicId is required");

  const doc = await TelemedSession.findOneAndUpdate(
    { _id: id, clinicId },
    { $set: { status: "cancelled", endedAt: new Date() } },
    { new: true },
  ).lean();
  if (!doc) throw new NotFoundError("Telemed session not found");

  logger?.info?.(
    { clinicId: String(clinicId), sessionId: String(id) },
    "telemed session cancelled",
  );
  return decrypt(doc);
}
