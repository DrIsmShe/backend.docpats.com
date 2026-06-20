// server/modules/clinic/clinic-announcements/services/announcement.service.js
//
// Business logic for the clinic corporate-portal announcements (bulletin board).
// Mirrors knowledge.service / room.service conventions.
//
// ─────────────────────────────────────────────────────────────────────────────
//  ARCHITECTURE
// ─────────────────────────────────────────────────────────────────────────────
//   1. tenantContext (AsyncLocalStorage) → clinicId + membershipId + actorType.
//   2. Author & readers identified by ClinicMembership._id (uniform across
//      doctor "user" and staff "employee" actors).
//   3. NON-PHI → no encryption of announcement body.
//   4. On create: fan-out a notification to every ACTIVE clinic member that
//      has a User account (notify() targets User._id). Members that are
//      ClinicEmployee-only still see the announcement in the feed; an
//      employee notification channel is a later addition.
//   5. Cross-module models resolved lazily via mongoose.model(name) registry
//      (avoids brittle ../ import paths — same approach as consilium service).
//
// ─────────────────────────────────────────────────────────────────────────────

import mongoose from "mongoose";
import ClinicAnnouncement from "../models/clinicAnnouncement.model.js";
import {
  getCurrentClinicId,
  getCurrentMembershipId,
} from "../../../../common/context/tenantContext.js";
import {
  NotFoundError,
  ForbiddenError,
  UnprocessableError,
} from "../../../../common/utils/errors.js";

// Lazy model registry accessors (models are registered elsewhere at boot).
const Membership = () => mongoose.model("ClinicMembership");
const User = () => mongoose.model("User");
const ClinicEmployee = () => mongoose.model("ClinicEmployee");

function requireClinicId() {
  const clinicId = getCurrentClinicId();
  if (!clinicId) throw new ForbiddenError("No active clinic context");
  return clinicId;
}

function requireMembershipId() {
  const membershipId = getCurrentMembershipId();
  if (!membershipId) throw new ForbiddenError("Clinic membership required");
  return membershipId;
}

// ── Resolve a display name for a membership (user OR employee actor) ──
async function resolveMemberName(membership) {
  if (!membership) return "";
  try {
    if (membership.actorType === "employee") {
      const emp = await ClinicEmployee()
        .findById(membership.userId)
        .select("firstNameEncrypted lastNameEncrypted")
        .lean();
      if (!emp) return "";
      // ClinicEmployee uses decryptValue (named export). Use the model's
      // helper if exposed; fall back to a direct toJSON-style decrypt.
      const { decryptValue } =
        await import("../../clinic-staff/models/clinicEmployee.model.js").catch(
          () => ({}),
        );
      if (decryptValue) {
        return `${decryptValue(emp.firstNameEncrypted)} ${decryptValue(
          emp.lastNameEncrypted,
        )}`.trim();
      }
      return "";
    }
    // actorType "user" (doctor / owner)
    const u = await User()
      .findById(membership.userId)
      .select("firstNameEncrypted lastNameEncrypted")
      .lean();
    if (!u) return "";
    const { decrypt } =
      await import("../../../../common/models/Auth/users.js").catch(() => ({}));
    if (decrypt) {
      return `${decrypt(u.firstNameEncrypted)} ${decrypt(
        u.lastNameEncrypted,
      )}`.trim();
    }
    return "";
  } catch {
    return "";
  }
}

// ── Best-effort notification fan-out to clinic members with User accounts ──
async function notifyMembers({ clinicId, authorMembershipId, title }) {
  try {
    const { notify } =
      await import("../../../notifications/services/notification.service.js").catch(
        () => ({}),
      );
    if (!notify) return;

    const members = await Membership()
      .find({ clinicId, leftAt: null, actorType: "user" })
      .select("_id userId")
      .lean();

    await Promise.all(
      members
        .filter((m) => String(m._id) !== String(authorMembershipId) && m.userId)
        .map((m) =>
          notify({
            userId: m.userId,
            type: "system_message",
            title: "Новое объявление",
            message: title,
            link: "/clinic/announcements",
            priority: "normal",
            icon: "megaphone",
          }).catch(() => {}),
        ),
    );
  } catch {
    // notifications are best-effort — never block announcement creation
  }
}

// ── API shape ────────────────────────────────────────────────────
function toApiShape(doc, viewerMembershipId) {
  if (!doc) return null;
  const readBy = Array.isArray(doc.readBy) ? doc.readBy : [];
  const viewerHasRead = viewerMembershipId
    ? readBy.some((r) => String(r.membershipId) === String(viewerMembershipId))
    : false;
  return {
    _id: String(doc._id),
    title: doc.title || "",
    body: doc.body || "",
    audience: doc.audience,
    departmentId: doc.departmentId ? String(doc.departmentId) : null,
    pinned: !!doc.pinned,
    status: doc.status,
    authorMembershipId: doc.authorMembershipId
      ? String(doc.authorMembershipId)
      : null,
    authorName: doc.authorName || "",
    readCount: readBy.length,
    viewerHasRead,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

// ─────────────────────────────────────────────────────────────────────────
//  CREATE
// ─────────────────────────────────────────────────────────────────────────
export async function createAnnouncement({ body }) {
  const clinicId = requireClinicId();
  const membershipId = requireMembershipId();

  const title = (body.title || "").trim();
  const text = (body.body || "").trim();
  if (!title) throw new UnprocessableError("Title is required");
  if (!text) throw new UnprocessableError("Body is required");

  const audience = body.audience === "department" ? "department" : "all";
  const departmentId =
    audience === "department" ? body.departmentId || null : null;
  if (audience === "department" && !departmentId) {
    throw new UnprocessableError(
      "departmentId is required for department audience",
    );
  }

  const membership = await Membership().findById(membershipId).lean();
  const authorName = await resolveMemberName(membership);

  const doc = await ClinicAnnouncement.create({
    clinicId,
    authorMembershipId: membershipId,
    authorName,
    title,
    body: text,
    audience,
    departmentId,
    pinned: !!body.pinned,
    status: "published",
    createdBy: membershipId,
  });

  // fire-and-forget fan-out
  notifyMembers({ clinicId, authorMembershipId: membershipId, title });

  return toApiShape(doc.toObject(), membershipId);
}

// ─────────────────────────────────────────────────────────────────────────
//  LIST (clinic feed — pinned first, then newest)
// ─────────────────────────────────────────────────────────────────────────
export async function listAnnouncements({ query }) {
  const clinicId = requireClinicId();
  const viewer = getCurrentMembershipId();

  const { status, departmentId, includeArchived } = query || {};

  const filter = { clinicId };
  if (status) {
    filter.status = status;
  } else if (!includeArchived) {
    filter.status = "published";
  }
  if (departmentId) filter.departmentId = departmentId;

  const docs = await ClinicAnnouncement.find(filter)
    .sort({ pinned: -1, createdAt: -1 })
    .limit(200)
    .lean();

  return { items: docs.map((d) => toApiShape(d, viewer)) };
}

// ─────────────────────────────────────────────────────────────────────────
//  GET ONE (+ auto mark-as-read for the viewer)
// ─────────────────────────────────────────────────────────────────────────
export async function getAnnouncement({ id }) {
  const clinicId = requireClinicId();
  const viewer = getCurrentMembershipId();

  const doc = await ClinicAnnouncement.findOne({ _id: id, clinicId });
  if (!doc) throw new NotFoundError("Announcement");

  // Auto read-receipt: record viewer if not already present.
  if (viewer) {
    const already = doc.readBy.some(
      (r) => String(r.membershipId) === String(viewer),
    );
    if (!already) {
      doc.readBy.push({ membershipId: viewer, at: new Date() });
      await doc.save();
    }
  }

  return toApiShape(doc.toObject(), viewer);
}

// ─────────────────────────────────────────────────────────────────────────
//  MARK READ (explicit — e.g. "mark all read" or list-level)
// ─────────────────────────────────────────────────────────────────────────
export async function markRead({ id }) {
  const clinicId = requireClinicId();
  const viewer = requireMembershipId();

  const doc = await ClinicAnnouncement.findOne({ _id: id, clinicId });
  if (!doc) throw new NotFoundError("Announcement");

  const already = doc.readBy.some(
    (r) => String(r.membershipId) === String(viewer),
  );
  if (!already) {
    doc.readBy.push({ membershipId: viewer, at: new Date() });
    await doc.save();
  }
  return toApiShape(doc.toObject(), viewer);
}

// ─────────────────────────────────────────────────────────────────────────
//  READ RECEIPTS (author view: who has read it, names resolved)
// ─────────────────────────────────────────────────────────────────────────
export async function getReadReceipts({ id }) {
  const clinicId = requireClinicId();

  const doc = await ClinicAnnouncement.findOne({ _id: id, clinicId }).lean();
  if (!doc) throw new NotFoundError("Announcement");

  const activeMembers = await Membership()
    .find({ clinicId, leftAt: null })
    .select("_id")
    .lean();
  const totalMembers = activeMembers.length;

  const readSet = new Set(
    (doc.readBy || []).map((r) => String(r.membershipId)),
  );

  // Resolve reader names.
  const readers = [];
  for (const r of doc.readBy || []) {
    const m = await Membership().findById(r.membershipId).lean();
    readers.push({
      membershipId: String(r.membershipId),
      name: await resolveMemberName(m),
      at: r.at,
    });
  }

  return {
    readCount: readSet.size,
    totalMembers,
    readers,
  };
}

// ─────────────────────────────────────────────────────────────────────────
//  PIN / UNPIN
// ─────────────────────────────────────────────────────────────────────────
export async function setPinned({ id, pinned }) {
  const clinicId = requireClinicId();
  const viewer = getCurrentMembershipId();

  const doc = await ClinicAnnouncement.findOneAndUpdate(
    { _id: id, clinicId },
    { $set: { pinned: !!pinned } },
    { new: true },
  );
  if (!doc) throw new NotFoundError("Announcement");
  return toApiShape(doc.toObject(), viewer);
}

// ─────────────────────────────────────────────────────────────────────────
//  ARCHIVE
// ─────────────────────────────────────────────────────────────────────────
export async function archiveAnnouncement({ id }) {
  const clinicId = requireClinicId();
  const viewer = getCurrentMembershipId();

  const doc = await ClinicAnnouncement.findOneAndUpdate(
    { _id: id, clinicId },
    { $set: { status: "archived" } },
    { new: true },
  );
  if (!doc) throw new NotFoundError("Announcement");
  return toApiShape(doc.toObject(), viewer);
}
// ─── UNARCHIVE (archived → published) ───────────────────────────
export async function unarchiveAnnouncement({ id }) {
  const clinicId = requireClinicId();
  const viewer = getCurrentMembershipId();

  const doc = await ClinicAnnouncement.findOneAndUpdate(
    { _id: id, clinicId },
    { $set: { status: "published" } },
    { new: true },
  );
  if (!doc) throw new NotFoundError("Announcement");
  return toApiShape(doc.toObject(), viewer);
}
// ─────────────────────────────────────────────────────────────────────────
//  DELETE (hard)
// ─────────────────────────────────────────────────────────────────────────
export async function deleteAnnouncement({ id }) {
  const clinicId = requireClinicId();

  const doc = await ClinicAnnouncement.findOneAndDelete({ _id: id, clinicId });
  if (!doc) throw new NotFoundError("Announcement");
  return { announcementId: String(doc._id), deleted: true };
}
