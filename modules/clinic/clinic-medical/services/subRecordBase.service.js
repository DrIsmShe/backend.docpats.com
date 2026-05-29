// modules/clinic/clinic-medical/services/subRecordBase.service.js
//
// Generic CRUD core for clinic-medical PATIENT-ATTRIBUTE sub-records:
//   allergies, chronicDiseases, operations, familyHistory, immunization.
//
// Sprint 2 Phase 2C.
//
// ─────────────────────────────────────────────────────────────────────────────
//  DESIGN
// ─────────────────────────────────────────────────────────────────────────────
//
// All five sub-models share the SAME shape:
//   patientId + (doctorId | createdByEmployee) + createdByClinicId
//   + sharedWith + <content fields specific to the model>
//
// This base provides the shared logic. Each concrete sub-model supplies
// a CONFIG describing:
//   - Model         — the mongoose model
//   - scope         — PatientConsent scope key ("allergies" etc)
//   - resourceType  — audit resource type ("clinic-medical-allergy" etc)
//   - actions       — audit action strings { create, read, list, update, delete }
//   - events        — eventBus names (or null to skip)
//   - mapBody(body) — extract content fields from request body → model fields
//
// Access chain (same as encounter):
//   1. ownership      — createdByClinicId === currentClinicId
//   2. per-record     — sharedWith includes currentClinicId
//   3. global consent — PatientConsent.checkScope(patientRef, clinicId, scope)
//
// Authorship:
//   - user actor    → doctorId = userId
//   - employee actor → createdByEmployee = userId
//   (sub-models use doctorId as the "User author" field, not createdBy —
//    matches the legacy field name in the models)

import PatientConsent from "../../../../common/models/Polyclinic/PatientConsent.js";
import { eventBus } from "../../../../common/events/eventBus.js";
import {
  NotFoundError,
  ForbiddenError,
  UnprocessableError,
} from "../../../../common/utils/errors.js";
import {
  getCurrentClinicId,
  getCurrentUserId,
  getCurrentActorType,
} from "../../../../common/context/tenantContext.js";
import { require as requirePerm } from "../../../../common/auth/can.js";
import logger from "../../../../common/logger.js";

const log = logger.child({ module: "clinic-medical/subRecord" });

// ─── context helpers ──────────────────────────────────────────────────

function requireClinicId() {
  const clinicId = getCurrentClinicId();
  if (!clinicId) throw new ForbiddenError("No active clinic context");
  return clinicId;
}

function requireActor() {
  const userId = getCurrentUserId();
  const actorType = getCurrentActorType();
  if (!userId || !actorType) {
    throw new ForbiddenError("Authenticated actor required");
  }
  return { userId, actorType };
}

// ─── shared response shaper ───────────────────────────────────────────

function baseShape(doc) {
  return {
    _id: String(doc._id),
    patientId: doc.patientId ? String(doc.patientId) : null,
    doctorId: doc.doctorId ? String(doc.doctorId) : null,
    createdByEmployee: doc.createdByEmployee
      ? String(doc.createdByEmployee)
      : null,
    createdByClinicId: doc.createdByClinicId
      ? String(doc.createdByClinicId)
      : null,
    sharedWith: Array.isArray(doc.sharedWith)
      ? doc.sharedWith.map((id) => String(id))
      : [],
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

// ─── access decision (per-record) ─────────────────────────────────────
//
// Given a record + current clinic, returns:
//   { granted: bool, reason: string, isCrossClinic: bool }

async function decideRecordAccess(record, clinicId, scope) {
  // 1. Ownership
  if (
    record.createdByClinicId &&
    String(record.createdByClinicId) === String(clinicId)
  ) {
    return { granted: true, reason: "ownership", isCrossClinic: false };
  }

  // 2. Per-record sharing
  if (Array.isArray(record.sharedWith)) {
    const shared = record.sharedWith.some(
      (id) => String(id) === String(clinicId),
    );
    if (shared) {
      return { granted: true, reason: "shared_with", isCrossClinic: true };
    }
  }

  // 3. Global consent
  if (record.patientId) {
    const allowed = await PatientConsent.checkScope(
      record.patientId,
      clinicId,
      scope,
    );
    if (allowed) {
      return { granted: true, reason: "global_consent", isCrossClinic: true };
    }
  }

  return { granted: false, reason: "denied", isCrossClinic: false };
}

// ─────────────────────────────────────────────────────────────────────────
//  FACTORY — build a service object for a given sub-model config
// ─────────────────────────────────────────────────────────────────────────

/**
 * @param {object} config
 * @param {mongoose.Model} config.Model
 * @param {string} config.scope          PatientConsent scope key
 * @param {object} config.events         { created, updated, deleted } event names or null
 * @param {function} config.mapBody      (body) => object of content fields
 * @param {function} [config.shapeExtra] (doc) => object merged into response shape
 * @returns {object} service with create/get/list/update/remove
 */
export function buildSubRecordService(config) {
  const { Model, scope, events = {}, mapBody, shapeExtra } = config;

  if (!Model || !scope || typeof mapBody !== "function") {
    throw new Error("buildSubRecordService requires Model, scope, and mapBody");
  }

  function toShape(doc) {
    const base = baseShape(doc);
    const extra = typeof shapeExtra === "function" ? shapeExtra(doc) : {};
    return { ...base, ...extra };
  }

  // ─── CREATE ──────────────────────────────────────────────────────
  async function create({ patient, body }) {
    requirePerm("medical_record", "write");
    const clinicId = requireClinicId();
    const { userId, actorType } = requireActor();

    if (!patient || !patient._id) {
      throw new UnprocessableError("Patient is required");
    }

    const authorship =
      actorType === "employee"
        ? { doctorId: null, createdByEmployee: userId }
        : { doctorId: userId, createdByEmployee: null };

    const contentFields = mapBody(body);

    const payload = {
      patientId: patient._id,
      ...authorship,
      createdByClinicId: clinicId,
      sharedWith: Array.isArray(body.sharedWith) ? body.sharedWith : [],
      ...contentFields,
    };

    let doc;
    try {
      doc = new Model(payload);
      await doc.save();
    } catch (err) {
      if (
        err.name === "ValidationError" ||
        err.message?.includes("Author is required") ||
        err.message?.includes("Only one author allowed") ||
        err.message?.includes("createdByClinicId is required")
      ) {
        throw new UnprocessableError(err.message);
      }
      throw err;
    }

    log.info(
      {
        recordId: String(doc._id),
        model: Model.modelName,
        clinicId: String(clinicId),
        patientId: String(patient._id),
        actorType,
      },
      "Sub-record created",
    );

    if (events.created) {
      eventBus.emitSafe(events.created, {
        recordId: String(doc._id),
        model: Model.modelName,
        clinicId: String(clinicId),
        patientId: String(patient._id),
        createdBy: String(userId),
        actorType,
      });
    }

    return toShape(doc.toObject());
  }

  // ─── GET (single) ────────────────────────────────────────────────
  async function get({ recordId }) {
    requirePerm("medical_record", "read");
    const clinicId = requireClinicId();

    const doc = await Model.findById(recordId);
    if (!doc) throw new NotFoundError(Model.modelName);

    const decision = await decideRecordAccess(doc, clinicId, scope);
    if (!decision.granted) {
      throw new ForbiddenError("No access to this record", {
        code: "ACCESS_DENIED",
        scope,
      });
    }

    const shape = toShape(doc.toObject());
    if (decision.isCrossClinic) shape.isCrossClinic = true;
    return shape;
  }

  // ─── LIST (for a patient) ────────────────────────────────────────
  async function list({ patient, query = {} }) {
    requirePerm("medical_record", "read");
    const clinicId = requireClinicId();

    if (!patient || !patient._id) {
      throw new UnprocessableError("Patient is required");
    }

    const { limit = 100, before } = query;

    const hasGlobalConsent = await PatientConsent.checkScope(
      patient._id,
      clinicId,
      scope,
    );

    const accessOr = [
      { createdByClinicId: clinicId },
      { sharedWith: clinicId },
    ];
    if (hasGlobalConsent) accessOr.push({});

    const filter = {
      patientId: patient._id,
      $or: accessOr,
    };
    if (before) filter.createdAt = { $lt: before };

    const docs = await Model.find(filter)
      .sort({ createdAt: -1 })
      .limit(Math.min(limit, 200))
      .lean();

    const items = docs.map((doc) => {
      const shape = toShape(doc);
      const isCrossClinic =
        !doc.createdByClinicId ||
        String(doc.createdByClinicId) !== String(clinicId);
      if (isCrossClinic) shape.isCrossClinic = true;
      return shape;
    });

    const nextCursor =
      docs.length === limit && docs[docs.length - 1]
        ? docs[docs.length - 1].createdAt
        : null;

    return { items, nextCursor, count: items.length };
  }

  // ─── UPDATE ──────────────────────────────────────────────────────
  async function update({ recordId, body }) {
    requirePerm("medical_record", "write");
    const clinicId = requireClinicId();
    const { userId } = requireActor();

    const doc = await Model.findById(recordId);
    if (!doc) throw new NotFoundError(Model.modelName);

    // Only the OWNER clinic may edit. Cross-clinic (consent/shared) is
    // read-only — they can see but not modify another clinic's record.
    if (
      !doc.createdByClinicId ||
      String(doc.createdByClinicId) !== String(clinicId)
    ) {
      throw new ForbiddenError(
        "Only the clinic that created this record can edit it",
        { code: "NOT_RECORD_OWNER" },
      );
    }

    const contentFields = mapBody(body, { partial: true });
    for (const [key, value] of Object.entries(contentFields)) {
      if (value !== undefined) doc[key] = value;
    }
    if (Array.isArray(body.sharedWith)) {
      doc.sharedWith = body.sharedWith;
    }

    await doc.save();

    if (events.updated) {
      eventBus.emitSafe(events.updated, {
        recordId: String(doc._id),
        model: Model.modelName,
        clinicId: String(clinicId),
        updatedBy: String(userId),
      });
    }

    return toShape(doc.toObject());
  }

  // ─── DELETE ──────────────────────────────────────────────────────
  async function remove({ recordId }) {
    requirePerm("medical_record", "delete");
    const clinicId = requireClinicId();
    const { userId } = requireActor();

    const doc = await Model.findById(recordId);
    if (!doc) throw new NotFoundError(Model.modelName);

    // Owner-only delete
    if (
      !doc.createdByClinicId ||
      String(doc.createdByClinicId) !== String(clinicId)
    ) {
      throw new ForbiddenError(
        "Only the clinic that created this record can delete it",
        { code: "NOT_RECORD_OWNER" },
      );
    }

    const recordIdStr = String(doc._id);
    await doc.deleteOne();

    log.warn(
      {
        recordId: recordIdStr,
        model: Model.modelName,
        deletedBy: String(userId),
      },
      "Sub-record deleted",
    );

    if (events.deleted) {
      eventBus.emitSafe(events.deleted, {
        recordId: recordIdStr,
        model: Model.modelName,
        clinicId: String(clinicId),
        deletedBy: String(userId),
      });
    }

    return { recordId: recordIdStr, deleted: true };
  }

  return { create, get, list, update, remove, toShape, _config: config };
}

export default buildSubRecordService;
