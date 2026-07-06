// server/modules/clinic/clinic-staff/services/membershipRequest.service.js
//
// Variant 2 of "add a User-member to a clinic": instead of silently creating a
// membership, the owner picks an EXISTING DocPats User (doctor OR patient) and
// sends a MembershipRequest. The invitee accepts/rejects in their cabinet. On
// accept, the real ClinicMembership (actorType "user") is created — mirroring
// addStaff()'s STAFF_JOINED side-effect.
//
// Notifications (role-neutral — the invitee may be admin/doctor, and their
// account may be a doctor OR a patient, so text must not assume "врач"):
//   - create  → notify the invited user ("you have an invitation")
//   - accept  → notify the owner (invitee joined)
//   - reject  → notify the owner
//
// Tenant note: createRequest / cancelRequest run in clinic context (owner side,
// tenant-scoped). listMyRequests / accept / reject run on the INVITEE side under
// authMiddleware only (no clinic context), so they query by userId with
// skipTenantScope and resolve clinicId from the request document itself.

import MembershipRequest from "../models/membershipRequest.model.js";
import { notify } from "../../../notifications/services/notification.service.js";
import { eventBus, EVENTS } from "../../../../common/events/eventBus.js";
import {
  getCurrentClinicId,
  getCurrentUserId,
} from "../../../../common/context/tenantContext.js";
import {
  ConflictError,
  NotFoundError,
  ForbiddenError,
} from "../../../../common/utils/errors.js";
import logger from "../../../../common/logger.js";

const log = logger.child({ module: "clinic-staff/membership-request" });

// Single shared landing route where ANY authenticated User (doctor or patient)
// reviews and accepts/rejects clinic invitations. Must be a role-neutral
// authenticated route on the frontend, backed by the /my-membership-requests
// endpoints. (Variant B: swap for a role-conditional link if doctors and
// patients get separate cabinets — would require looking up the invitee's
// account type here.)
const INVITEE_LANDING = "/clinic/my-invitations";

// Human-readable role label for the invitation message.
function roleLabel(role) {
  switch (role) {
    case "admin":
      return "администратора";
    case "doctor":
      return "врача";
    case "owner":
      return "владельца";
    default:
      return "сотрудника";
  }
}

function requireClinicId() {
  const clinicId = getCurrentClinicId();
  if (!clinicId) throw new ForbiddenError("No active clinic context");
  return clinicId;
}

async function resolveClinicName(clinicId) {
  try {
    const Clinic = (await import("../../clinic-core/models/clinic.model.js"))
      .default;
    const c = await Clinic.findById(clinicId).select("name").lean();
    return c?.name || "";
  } catch {
    return "";
  }
}

// ─── CREATE (owner side, tenant-scoped) ──────────────────────────
// Creates a pending request and notifies the invited user.
export async function createRequest({
  userId,
  role,
  customTitle,
  employmentType,
}) {
  const clinicId = requireClinicId();
  const invitedBy = getCurrentUserId();

  if (!userId) throw new ForbiddenError("userId is required");

  // Already an active member?
  const ClinicMembership = (await import("../models/clinicMembership.model.js"))
    .default;
  const existingMember = await ClinicMembership.findOne({
    userId,
    clinicId,
    leftAt: null,
  });
  if (existingMember) {
    throw new ConflictError(
      "User already has an active membership in this clinic",
    );
  }

  // Already a pending request?
  const existingReq = await MembershipRequest.findOne({
    clinicId,
    userId,
    status: "pending",
  });
  if (existingReq) {
    throw new ConflictError(
      "A pending invitation already exists for this user",
      {
        requestId: String(existingReq._id),
      },
    );
  }

  const clinicName = await resolveClinicName(clinicId);

  const reqDoc = await MembershipRequest.create({
    clinicId,
    userId,
    role,
    customTitle: customTitle || "",
    employmentType: employmentType || null,
    invitedBy,
    clinicName,
    status: "pending",
  });

  // Notify the invited user (role-neutral text).
  const asLabel = roleLabel(role);
  notify({
    userId,
    type: "system_message",
    title: "Приглашение в клинику",
    message: clinicName
      ? `Клиника «${clinicName}» приглашает вас присоединиться как ${asLabel}.`
      : `Вас приглашают в клинику как ${asLabel}.`,
    link: INVITEE_LANDING,
    meta: {
      clinicId: String(clinicId),
      requestId: String(reqDoc._id),
      kind: "membership_request",
    },
  }).catch((err) =>
    log.error({ err: err.message }, "notify(create membership request) failed"),
  );

  log.info(
    {
      requestId: String(reqDoc._id),
      userId: String(userId),
      clinicId: String(clinicId),
    },
    "Membership request created",
  );

  return reqDoc.toObject();
}

// ─── LIST MY REQUESTS (invitee side, authMiddleware only) ────────
export async function listMyRequests(userId) {
  if (!userId) return [];
  const requests = await MembershipRequest.find(
    { userId, status: "pending" },
    null,
    { skipTenantScope: true },
  )
    .sort({ createdAt: -1 })
    .lean();

  // Resolve fresh clinic names.
  if (requests.length === 0) return [];
  const Clinic = (await import("../../clinic-core/models/clinic.model.js"))
    .default;
  const ids = requests.map((r) => r.clinicId);
  const clinics = await Clinic.find({ _id: { $in: ids } }, null, {
    skipTenantScope: true,
  })
    .select("_id name city logo")
    .lean();
  const map = new Map(clinics.map((c) => [String(c._id), c]));

  return requests.map((r) => {
    const c = map.get(String(r.clinicId)) || {};
    return {
      requestId: String(r._id),
      clinicId: String(r.clinicId),
      clinicName: c.name || r.clinicName || "Клиника",
      clinicCity: c.city || null,
      clinicLogo: c.logo || null,
      role: r.role,
      customTitle: r.customTitle || null,
      createdAt: r.createdAt,
    };
  });
}

// ─── ACCEPT (invitee side) ───────────────────────────────────────
export async function acceptRequest(userId, requestId) {
  if (!userId) throw new ForbiddenError("Not authenticated");

  const reqDoc = await MembershipRequest.findOne(
    { _id: requestId, userId, status: "pending" },
    null,
    { skipTenantScope: true },
  );
  if (!reqDoc) throw new NotFoundError("Membership request");

  const ClinicMembership = (await import("../models/clinicMembership.model.js"))
    .default;

  // Guard: maybe a membership already exists (e.g. double-accept).
  const existing = await ClinicMembership.findOne(
    { userId: reqDoc.userId, clinicId: reqDoc.clinicId, leftAt: null },
    null,
    { skipTenantScope: true },
  );

  let membership = existing;
  if (!existing) {
    // Create membership directly — the invitee has no clinic context here, so
    // we must NOT rely on getCurrentClinicId()/addStaff (which read context).
    // clinicId comes from the request document itself.
    membership = await ClinicMembership.create({
      userId: reqDoc.userId,
      clinicId: reqDoc.clinicId,
      role: reqDoc.role,
      customTitle: reqDoc.customTitle,
      employmentType: reqDoc.employmentType,
      invitedBy: reqDoc.invitedBy,
      actorType: "user",
      joinedAt: new Date(),
      isActive: true,
    });

    // Mirror addStaff's side-effect so downstream listeners still fire.
    eventBus.emitSafe(EVENTS.STAFF_JOINED, {
      membershipId: String(membership._id),
      userId: String(reqDoc.userId),
      clinicId: String(reqDoc.clinicId),
      role: reqDoc.role,
    });
  }

  reqDoc.status = "accepted";
  reqDoc.respondedAt = new Date();
  reqDoc.membershipId = membership?._id || null;
  await reqDoc.save();

  // Notify the inviter that the invitee accepted (role-neutral).
  notify({
    userId: reqDoc.invitedBy,
    type: "system_message",
    title: "Приглашение принято",
    message:
      "Приглашённый пользователь принял приглашение и присоединился к клинике.",
    link: "/clinic/staff",
    meta: {
      clinicId: String(reqDoc.clinicId),
      requestId: String(reqDoc._id),
      kind: "membership_request_accepted",
    },
  }).catch((err) => log.error({ err: err.message }, "notify(accept) failed"));

  log.info(
    { requestId: String(reqDoc._id), userId: String(userId) },
    "Membership request accepted",
  );

  return { requestId: String(reqDoc._id), status: "accepted" };
}

// ─── REJECT (invitee side) ───────────────────────────────────────
export async function rejectRequest(userId, requestId) {
  if (!userId) throw new ForbiddenError("Not authenticated");

  const reqDoc = await MembershipRequest.findOne(
    { _id: requestId, userId, status: "pending" },
    null,
    { skipTenantScope: true },
  );
  if (!reqDoc) throw new NotFoundError("Membership request");

  reqDoc.status = "rejected";
  reqDoc.respondedAt = new Date();
  await reqDoc.save();

  notify({
    userId: reqDoc.invitedBy,
    type: "system_message",
    title: "Приглашение отклонено",
    message: "Приглашённый пользователь отклонил приглашение в клинику.",
    link: "/clinic/staff",
    meta: {
      clinicId: String(reqDoc.clinicId),
      requestId: String(reqDoc._id),
      kind: "membership_request_rejected",
    },
  }).catch((err) => log.error({ err: err.message }, "notify(reject) failed"));

  log.info(
    { requestId: String(reqDoc._id), userId: String(userId) },
    "Membership request rejected",
  );

  return { requestId: String(reqDoc._id), status: "rejected" };
}

// ─── CANCEL (owner side, tenant-scoped) ──────────────────────────
export async function cancelRequest(requestId) {
  const clinicId = requireClinicId();
  const reqDoc = await MembershipRequest.findOne({
    _id: requestId,
    clinicId,
    status: "pending",
  });
  if (!reqDoc) throw new NotFoundError("Membership request");

  reqDoc.status = "cancelled";
  reqDoc.respondedAt = new Date();
  await reqDoc.save();

  return { requestId: String(reqDoc._id), status: "cancelled" };
}

// ─── LIST CLINIC REQUESTS (owner side) ───────────────────────────
// Enriches each pending request with the invited user's decrypted
// name/email (same approach as listStaff: bulk fetch + decrypt helper).
// Note: response keys keep the doctor* prefix for frontend-contract
// compatibility; the invitee may actually be an admin/patient.
export async function listClinicRequests() {
  const clinicId = requireClinicId();
  const requests = await MembershipRequest.find({
    clinicId,
    status: "pending",
  })
    .sort({ createdAt: -1 })
    .lean();

  if (requests.length === 0) return [];

  // Bulk-fetch invited users + decrypt PII.
  const User = (await import("../../../../common/models/Auth/users.js"))
    .default;
  const { decrypt } = await import("../../../../common/models/Auth/users.js");
  const userIds = requests.map((r) => r.userId);
  const users = await User.find({ _id: { $in: userIds } })
    .select(
      "_id username avatar emailEncrypted firstNameEncrypted lastNameEncrypted",
    )
    .lean();
  const userMap = new Map(users.map((u) => [String(u._id), u]));

  const safe = (v) => {
    if (!v) return null;
    try {
      return decrypt(v) || null;
    } catch {
      return null;
    }
  };

  return requests.map((r) => {
    const u = userMap.get(String(r.userId)) || {};
    const firstName = safe(u.firstNameEncrypted);
    const lastName = safe(u.lastNameEncrypted);
    const email = safe(u.emailEncrypted);
    const name =
      [firstName, lastName].filter(Boolean).join(" ") ||
      u.username ||
      email ||
      null;
    return {
      requestId: String(r._id),
      userId: String(r.userId),
      doctorName: name,
      doctorEmail: email,
      doctorUsername: u.username || null,
      doctorAvatar: u.avatar || null,
      role: r.role,
      customTitle: r.customTitle || null,
      createdAt: r.createdAt,
    };
  });
}
