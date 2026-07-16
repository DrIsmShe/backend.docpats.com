// modules/clinic/clinic-core/services/deleteClinicCascade.service.js
//
// Cascade-delete a clinic and everything tied to it (hybrid strategy):
//
//   SOFT  — PHI / history: kept in DB but flagged, so audit & records survive.
//     Clinic, ClinicPatient, ClinicAppointment (softDeletePlugin);
//     Consilium (status:"archived"); ClinicMembership (leftAt);
//     StaffInvitation / ClinicMembershipInvite / MembershipRequest (revoked).
//
//   HARD  — construction/public data, cheap to recreate: physically removed.
//     announcements, schedules, schedule-exceptions, articles, departments,
//     equipment, gallery, knowledge, custom-pages, reviews, rooms, services,
//     telemed sessions.
//
//   SKIP  — never touched by a clinic deletion.
//     ClinicEmployee (GLOBAL identity — only its memberships are ended above);
//     LabResult (PHI, no soft-delete field — left intact);
//     ConsiliumMessage (follows its archived Consilium);
//     HIPAAAuditLog (must persist).
//
// Gate: OWNER only (ClinicMembership role "owner", actorType "user").
// Runs in a transaction when supported, so it's all-or-nothing.

import mongoose from "mongoose";

import Clinic from "../models/clinic.model.js";
import ClinicMembership from "../../clinic-staff/models/clinicMembership.model.js";
import { ROLES } from "../../../../common/auth/permissions.js";
import {
  ForbiddenError,
  NotFoundError,
  ConflictError,
} from "../../../../common/utils/errors.js";
import logger from "../../../../common/logger.js";

const log = logger.child({ module: "clinic-core/delete-cascade" });

// ─── Lazy model loaders (avoid circular imports across clinic modules) ───

async function loadModels() {
  const [
    ClinicPatient,
    ClinicAppointment,
    ClinicDoctorSchedule,
    ClinicScheduleException,
    Consilium,
    StaffInvitation,
    ClinicMembershipInvite,
    MembershipRequest,
    ClinicAnnouncement,
    ClinicArticle,
    ClinicDepartment,
    ClinicEquipment,
    ClinicGalleryItem,
    ClinicKnowledgeArticle,
    ClinicCustomPage,
    Review,
    ClinicRoom,
    ClinicService,
    TelemedSession,
  ] = await Promise.all([
    import("../../clinic-patients/models/clinicPatient.model.js"),
    import("../../clinic-appointments/models/clinicAppointment.model.js"),
    import("../../clinic-appointments/models/clinicDoctorSchedule.model.js"),
    import("../../clinic-appointments/models/clinicScheduleException.model.js"),
    import("../../clinic-consilium/models/consilium.model.js"),
    import("../../clinic-staff/models/staffInvitation.model.js"),
    import("../../clinic-staff/models/clinicMembershipInvite.model.js"),
    import("../../clinic-staff/models/membershipRequest.model.js"),
    import("../../clinic-announcements/models/clinicAnnouncement.model.js"),
    import("../../clinic-articles/models/clinicArticle.model.js"),
    import("../../clinic-departments/models/clinicDepartment.model.js"),
    import("../../clinic-equipment/models/clinicEquipment.model.js"),
    import("../../clinic-gallery/models/clinicGalleryItem.model.js"),
    import("../../clinic-knowledge/models/clinicKnowledgeArticle.model.js"),
    import("../../clinic-pages/models/clinicCustomPage.model.js"),
    import("../../clinic-reviews/models/review.model.js"),
    import("../../clinic-rooms/models/clinicRoom.model.js"),
    import("../../clinic-services/models/clinicService.model.js"),
    import("../../clinic-telemed/models/telemedSession.model.js"),
  ]);

  return {
    ClinicPatient: ClinicPatient.default,
    ClinicAppointment: ClinicAppointment.default,
    ClinicDoctorSchedule: ClinicDoctorSchedule.default,
    ClinicScheduleException: ClinicScheduleException.default,
    Consilium: Consilium.default,
    StaffInvitation: StaffInvitation.default,
    ClinicMembershipInvite: ClinicMembershipInvite.default,
    MembershipRequest: MembershipRequest.default,
    ClinicAnnouncement: ClinicAnnouncement.default,
    ClinicArticle: ClinicArticle.default,
    ClinicDepartment: ClinicDepartment.default,
    ClinicEquipment: ClinicEquipment.default,
    ClinicGalleryItem: ClinicGalleryItem.default,
    ClinicKnowledgeArticle: ClinicKnowledgeArticle.default,
    ClinicCustomPage: ClinicCustomPage.default,
    Review: Review.default,
    ClinicRoom: ClinicRoom.default,
    ClinicService: ClinicService.default,
    TelemedSession: TelemedSession.default,
  };
}

let _txSupportCache = null;
async function supportsTransactions() {
  if (_txSupportCache !== null) return _txSupportCache;
  try {
    const admin = mongoose.connection.db?.admin();
    if (!admin) return (_txSupportCache = false);
    const info = await admin.command({ hello: 1 });
    _txSupportCache = Boolean(info.setName) || info.msg === "isdbgrid";
  } catch {
    _txSupportCache = false;
  }
  return _txSupportCache;
}

/**
 * Verify the actor is an active OWNER of the clinic.
 * @throws {ForbiddenError}
 */
async function assertOwner(clinicId, actorUserId) {
  const membership = await ClinicMembership.findOne({
    clinicId,
    userId: actorUserId,
    role: ROLES.OWNER,
    actorType: "user",
    leftAt: null,
  }).lean();

  if (!membership) {
    throw new ForbiddenError("Only the clinic owner can delete the clinic");
  }
}

/**
 * Cascade-delete a clinic (owner only).
 *
 * @param {object} args
 * @param {string} args.clinicId
 * @param {string} args.actorUserId
 * @param {string} args.confirmationName — must equal the clinic's name
 * @returns {Promise<{clinicId, hardDeleted, softDeleted}>}
 */
export async function deleteClinicCascade({
  clinicId,
  actorUserId,
  confirmationName,
  bypassOwnerCheck = false,
}) {
  if (!mongoose.isValidObjectId(clinicId)) {
    throw new NotFoundError("Clinic not found");
  }

  const clinic = await Clinic.findById(clinicId);
  if (!clinic || clinic.isDeleted) {
    throw new NotFoundError("Clinic not found");
  }

  // Gate: OWNER only — КРОМЕ платформенного админа (bypassOwnerCheck), который
  // уже прошёл requireAdmin на своём роуте. Подтверждение по имени всё равно
  // обязательно (ниже), так что случайное удаление исключено.
  if (!bypassOwnerCheck) {
    await assertOwner(clinicId, actorUserId);
  }

  // Safety: require the exact clinic name as typed confirmation.
  if (!confirmationName || confirmationName.trim() !== clinic.name) {
    throw new ConflictError(
      "Confirmation name does not match the clinic name",
      { required: clinic.name },
    );
  }

  const models = await loadModels();
  const now = new Date();
  const useTransaction = await supportsTransactions();

  const counters = { hardDeleted: {}, softDeleted: {} };

  const run = async (session) => {
    const opt = session ? { session } : {};

    // ── HARD deletes (construction / public data) ──
    const hardModels = {
      announcements: models.ClinicAnnouncement,
      doctorSchedules: models.ClinicDoctorSchedule,
      scheduleExceptions: models.ClinicScheduleException,
      articles: models.ClinicArticle,
      departments: models.ClinicDepartment,
      equipment: models.ClinicEquipment,
      gallery: models.ClinicGalleryItem,
      knowledge: models.ClinicKnowledgeArticle,
      customPages: models.ClinicCustomPage,
      reviews: models.Review,
      rooms: models.ClinicRoom,
      services: models.ClinicService,
      telemedSessions: models.TelemedSession,
    };
    for (const [key, Model] of Object.entries(hardModels)) {
      const res = await Model.deleteMany({ clinicId }, opt);
      counters.hardDeleted[key] = res.deletedCount ?? 0;
    }

    // ── SOFT: PHI via softDeletePlugin ──
    // softDeletePlugin adds isDeleted/deletedAt; we set them directly here so
    // the operation is a single updateMany inside the transaction.
    for (const [key, Model] of [
      ["patients", models.ClinicPatient],
      ["appointments", models.ClinicAppointment],
    ]) {
      const res = await Model.updateMany(
        { clinicId, isDeleted: { $ne: true } },
        { $set: { isDeleted: true, deletedAt: now } },
        opt,
      );
      counters.softDeleted[key] = res.modifiedCount ?? res.nModified ?? 0;
    }

    // ── SOFT: Consilium → archived ──
    const consRes = await models.Consilium.updateMany(
      { clinicId, status: { $ne: "archived" } },
      { $set: { status: "archived" } },
      opt,
    );
    counters.softDeleted.consilia =
      consRes.modifiedCount ?? consRes.nModified ?? 0;

    // ── SOFT: end ALL memberships (owner, admin, employees) ──
    const memRes = await ClinicMembership.updateMany(
      { clinicId, leftAt: null },
      { $set: { leftAt: now, isActive: false } },
      opt,
    );
    counters.softDeleted.memberships =
      memRes.modifiedCount ?? memRes.nModified ?? 0;

    // ── SOFT: revoke pending invitations ──
    // StaffInvitation & ClinicMembershipInvite both use status "revoked" and
    // have revokedAt/revokedBy fields.
    for (const [key, Model] of [
      ["staffInvitations", models.StaffInvitation],
      ["membershipInvites", models.ClinicMembershipInvite],
    ]) {
      const res = await Model.updateMany(
        { clinicId, status: "pending" },
        { $set: { status: "revoked", revokedAt: now, revokedBy: actorUserId } },
        opt,
      );
      counters.softDeleted[key] = res.modifiedCount ?? res.nModified ?? 0;
    }

    // MembershipRequest has a different enum (no "revoked") and no
    // revokedAt/revokedBy fields — "cancelled" is the correct terminal state.
    const mrRes = await models.MembershipRequest.updateMany(
      { clinicId, status: "pending" },
      { $set: { status: "cancelled" } },
      opt,
    );
    counters.softDeleted.membershipRequests =
      mrRes.modifiedCount ?? mrRes.nModified ?? 0;

    // ── SOFT: the clinic itself ──
    clinic.isDeleted = true;
    clinic.deletedAt = now;
    clinic.deletedBy = actorUserId;
    clinic.isActive = false;
    await clinic.save(opt);
  };

  if (useTransaction) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await run(session);
      });
    } finally {
      await session.endSession();
    }
  } else {
    await run(null);
  }

  log.info(
    {
      clinicId: String(clinicId),
      deletedBy: String(actorUserId),
      hardDeleted: counters.hardDeleted,
      softDeleted: counters.softDeleted,
    },
    "Clinic cascade-deleted (hybrid: hard construction data, soft PHI/history)",
  );

  return {
    clinicId: String(clinicId),
    hardDeleted: counters.hardDeleted,
    softDeleted: counters.softDeleted,
  };
}
