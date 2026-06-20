// server/modules/clinic/clinic-consilium/services/consilium.service.js
//
// Business logic for Consilium + ConsiliumMessage.
//
// Conventions (mirrors room/equipment/knowledge services):
//   - clinicId is ALWAYS an explicit argument (no ALS); tenant-scoped.
//   - NO requirePerm here — RBAC upstream + frontend.
//   - departmentId (optional) is validated for clinic ownership (archived
//     departments allowed — a consilium can outlive a reorg).
//   - participantMembershipIds are validated against ClinicMembership.
//   - patientId is stored as-is (optional). Reads are clinic-scoped, so a
//     foreign id simply never resolves; no cross-module patient service is
//     imported here to avoid coupling. (Frontend only offers this clinic's
//     patients.)
//   - patientCanJoin (optional) is the explicit door for the patient into the
//     consilium video room — doctor-controlled, default false on the model.
//   - Message bodies are encrypted at rest (consiliumCrypto) and decrypted
//     on read.

import mongoose from "mongoose";
import Consilium from "../models/consilium.model.js";
import ConsiliumMessage from "../models/consiliumMessage.model.js";
import { encryptText, decryptText } from "./consiliumCrypto.js";
import {
  ValidationError,
  NotFoundError,
} from "../../../../common/utils/errors.js";
import logger from "../../../../common/logger.js";

// ─── helpers ──────────────────────────────────────────────────────────

// Validate that departmentId, if given, belongs to this clinic (archived OK).
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

// Validate participant memberships belong to this clinic; returns de-duped ids.
async function validateMemberships(clinicId, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const unique = [...new Set(ids.map((id) => String(id)))];

  const { default: ClinicMembership } =
    await import("../../clinic-staff/models/clinicMembership.model.js");
  const found = await ClinicMembership.find({
    _id: { $in: unique },
    clinicId,
  })
    .select("_id")
    .lean();

  if (found.length !== unique.length) {
    throw new ValidationError("Some participants do not belong to this clinic");
  }
  return unique.map((id) => new mongoose.Types.ObjectId(id));
}

// ─── createConsilium ───────────────────────────────────────────────────
export async function createConsilium(clinicId, input) {
  if (!clinicId) throw new ValidationError("clinicId is required");

  const departmentId = await assertDepartmentOwnership(
    clinicId,
    input.departmentId,
  );
  const participantMembershipIds = await validateMemberships(
    clinicId,
    input.participantMembershipIds,
  );

  const doc = await Consilium.create({
    clinicId,
    title: input.title,
    description: input.description ?? "",
    patientId: input.patientId ?? null,
    departmentId,
    initiatorMembershipId: input.initiatorMembershipId ?? null,
    participantMembershipIds,
    patientCanJoin: Boolean(input.patientCanJoin), // default false via model
    status: "open",
    createdBy: input.actorId ?? null,
  });
  return doc.toObject();
}

// ─── listConsilia ─────────────────────────────────────────────────────
export async function listConsilia(clinicId, filters = {}) {
  if (!clinicId) throw new ValidationError("clinicId is required");

  const query = { clinicId };
  if (filters.status) query.status = filters.status;
  if (filters.patientId) query.patientId = filters.patientId;
  if (filters.departmentId) query.departmentId = filters.departmentId;
  if (filters.participantMembershipId)
    query.participantMembershipIds = filters.participantMembershipId;

  if (filters.q && filters.q.trim()) {
    const safe = filters.q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rx = new RegExp(safe, "i");
    query.$or = [{ title: rx }, { description: rx }];
  }

  // Most recently active first.
  return Consilium.find(query).sort({ updatedAt: -1 }).lean();
}

// ─── getConsiliumById ─────────────────────────────────────────────────
export async function getConsiliumById(clinicId, id) {
  if (!clinicId) throw new ValidationError("clinicId is required");
  const doc = await Consilium.findOne({ _id: id, clinicId }).lean();
  if (!doc) throw new NotFoundError("Consilium not found");
  return doc;
}

// ─── updateConsilium ───────────────────────────────────────────────────
export async function updateConsilium(clinicId, id, input) {
  if (!clinicId) throw new ValidationError("clinicId is required");

  const existing = await Consilium.findOne({ _id: id, clinicId });
  if (!existing) throw new NotFoundError("Consilium not found");

  const update = {};

  if (input.title !== undefined) update.title = input.title;
  if (input.description !== undefined)
    update.description = input.description ?? "";
  if (input.patientId !== undefined) update.patientId = input.patientId ?? null;
  if (input.conclusion !== undefined)
    update.conclusion = input.conclusion ?? null;
  if (input.patientCanJoin !== undefined)
    update.patientCanJoin = Boolean(input.patientCanJoin);
  if (input.actorId !== undefined) update.updatedBy = input.actorId;

  if (input.departmentId !== undefined) {
    update.departmentId = await assertDepartmentOwnership(
      clinicId,
      input.departmentId,
    );
  }
  if (input.participantMembershipIds !== undefined) {
    update.participantMembershipIds = await validateMemberships(
      clinicId,
      input.participantMembershipIds,
    );
  }

  // Status transition: stamp resolvedAt the first time it resolves.
  if (input.status !== undefined && input.status !== existing.status) {
    update.status = input.status;
    if (input.status === "resolved" && !existing.resolvedAt) {
      update.resolvedAt = new Date();
    }
  }

  const doc = await Consilium.findOneAndUpdate(
    { _id: id, clinicId },
    { $set: update },
    { new: true, runValidators: true },
  ).lean();
  if (!doc) throw new NotFoundError("Consilium not found");
  return doc;
}

// ─── archiveConsilium (soft delete) ────────────────────────────────────
export async function archiveConsilium(clinicId, id) {
  if (!clinicId) throw new ValidationError("clinicId is required");
  const doc = await Consilium.findOneAndUpdate(
    { _id: id, clinicId },
    { $set: { status: "archived" } },
    { new: true },
  ).lean();
  if (!doc) throw new NotFoundError("Consilium not found");

  logger?.info?.(
    { clinicId: String(clinicId), consiliumId: String(id) },
    "consilium archived",
  );
  return doc;
}

// ─── addMessage (encrypts body, bumps counter) ─────────────────────────
export async function addMessage(clinicId, consiliumId, input) {
  if (!clinicId) throw new ValidationError("clinicId is required");

  // The consilium must exist in this clinic and be open.
  const consilium = await Consilium.findOne({ _id: consiliumId, clinicId });
  if (!consilium) throw new NotFoundError("Consilium not found");
  if (consilium.status === "archived") {
    throw new ValidationError("Cannot post to an archived consilium");
  }

  const textEncrypted = encryptText(input.text);

  const msg = await ConsiliumMessage.create({
    clinicId,
    consiliumId,
    authorMembershipId: input.authorMembershipId ?? null,
    textEncrypted,
    createdBy: input.actorId ?? null,
  });

  // Keep the denormalized counters in sync.
  const now = msg.createdAt || new Date();
  await Consilium.updateOne(
    { _id: consiliumId, clinicId },
    { $inc: { messageCount: 1 }, $set: { lastMessageAt: now } },
  );

  return decorateMessage(msg.toObject());
}

// ─── listMessages (decrypts bodies, chronological) ─────────────────────
export async function listMessages(clinicId, consiliumId) {
  if (!clinicId) throw new ValidationError("clinicId is required");

  // Ensure the consilium is in this clinic before returning its thread.
  const consilium = await Consilium.findOne({ _id: consiliumId, clinicId })
    .select("_id")
    .lean();
  if (!consilium) throw new NotFoundError("Consilium not found");

  const rows = await ConsiliumMessage.find({ clinicId, consiliumId })
    .sort({ createdAt: 1 })
    .lean();

  return rows.map(decorateMessage);
}

// Replace the stored ciphertext with a decrypted `text` for API output.
function decorateMessage(row) {
  let text = "";
  try {
    text = decryptText(row.textEncrypted);
  } catch (err) {
    logger?.warn?.(
      { messageId: String(row._id) },
      "consilium message decrypt failed",
    );
    text = "";
  }
  const { textEncrypted, ...rest } = row;
  return { ...rest, text };
}
