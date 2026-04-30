// server/modules/simulation/services/simulationPlan.service.js

import mongoose from "mongoose";
import SimulationPlan from "../models/SimulationPlan.js";
import { encrypt, safeDecrypt } from "./encryption.service.js";
import { deletePhotoObject } from "./upload.service.js";

function buildPhotoProxyUrl(r2Key) {
  if (!r2Key) return null;
  return `/api/simulation/photos/proxy?key=${encodeURIComponent(r2Key)}`;
}

function toPlanDTO(doc) {
  if (!doc) return null;
  const o = doc.toObject ? doc.toObject() : doc;

  const planType = o.planType || "face";

  return {
    id: String(o._id),
    doctorId: String(o.doctorId),
    planType,
    photoView: o.photoView || null,
    label: safeDecrypt(o.labelEncrypted, ""),
    patientRef: safeDecrypt(o.patientRefEncrypted, ""),
    photo: o.photo
      ? {
          url: buildPhotoProxyUrl(o.photo.r2Key),
          width: o.photo.width,
          height: o.photo.height,
          mimeType: o.photo.mimeType,
          uploadedAt: o.photo.uploadedAt,
        }
      : null,
    controlPoints: o.controlPoints || [],
    anatomy: o.anatomy || {},
    operation: o.operation || { type: null },
    calibration: o.calibration || {},
    warpTuning: o.warpTuning || {},
    landmarks: o.landmarks || [],
    landmarksMeta: o.landmarksMeta || {},
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    deletedAt: o.deletedAt || null,
  };
}

export async function createPlan(
  doctorId,
  { label, patientRef, photo, controlPoints },
) {
  const doc = await SimulationPlan.create({
    doctorId,
    labelEncrypted: encrypt(label),
    patientRefEncrypted: encrypt(patientRef || null),
    photo,
    controlPoints: controlPoints || [],
  });

  return toPlanDTO(doc);
}

export async function createBreastPlan(
  doctorId,
  {
    label,
    patientRef,
    photo,
    photoView,
    anatomy,
    operation,
    calibration,
    warpTuning,
    controlPoints,
  },
) {
  const doc = await SimulationPlan.create({
    doctorId,
    planType: "breast",
    photoView,
    labelEncrypted: encrypt(label),
    patientRefEncrypted: encrypt(patientRef || null),
    photo,
    controlPoints: controlPoints || [],
    anatomy: anatomy || {},
    operation: operation || { type: null },
    calibration: calibration || {},
    warpTuning: warpTuning || {},
  });

  return toPlanDTO(doc);
}

export async function listPlans(
  doctorId,
  { limit = 30, cursor, includeDeleted = false, planType } = {},
) {
  const query = { doctorId };

  if (!includeDeleted) {
    query.deletedAt = null;
  }

  if (planType === "face") {
    query.$or = [{ planType: "face" }, { planType: { $exists: false } }];
  } else if (planType) {
    query.planType = planType;
  }

  if (cursor) {
    query._id = { $lt: new mongoose.Types.ObjectId(cursor) };
  }

  const docs = await SimulationPlan.find(query)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .lean();

  const hasMore = docs.length > limit;
  const page = hasMore ? docs.slice(0, limit) : docs;

  return {
    items: page.map(toPlanDTO),
    nextCursor: hasMore ? String(page[page.length - 1]._id) : null,
    hasMore,
  };
}

export async function getPlanById(
  doctorId,
  planId,
  { includeDeleted = false } = {},
) {
  if (!mongoose.isValidObjectId(planId)) return null;

  const query = {
    _id: planId,
    doctorId,
  };

  if (!includeDeleted) {
    query.deletedAt = null;
  }

  const doc = await SimulationPlan.findOne(query);
  return toPlanDTO(doc);
}

export async function updatePlan(doctorId, planId, patch) {
  if (!mongoose.isValidObjectId(planId)) return null;

  const update = {};

  if (patch.label !== undefined) {
    update.labelEncrypted = encrypt(patch.label);
  }
  if (patch.patientRef !== undefined) {
    update.patientRefEncrypted = encrypt(patch.patientRef || null);
  }
  if (patch.controlPoints !== undefined) {
    update.controlPoints = patch.controlPoints;
  }
  if (patch.anatomy !== undefined) {
    update.anatomy = patch.anatomy;
  }
  if (patch.operation !== undefined) {
    update.operation = patch.operation;
  }
  if (patch.calibration !== undefined) {
    update.calibration = patch.calibration;
  }
  if (patch.warpTuning !== undefined) {
    update.warpTuning = patch.warpTuning;
  }

  if (Object.keys(update).length === 0) {
    return getPlanById(doctorId, planId);
  }

  const doc = await SimulationPlan.findOneAndUpdate(
    { _id: planId, doctorId, deletedAt: null },
    { $set: update },
    { new: true, runValidators: true },
  );

  return toPlanDTO(doc);
}

export async function deletePlan(doctorId, planId) {
  if (!mongoose.isValidObjectId(planId)) return null;

  const doc = await SimulationPlan.findOneAndUpdate(
    { _id: planId, doctorId },
    { $set: { deletedAt: new Date() } },
    { new: true },
  );

  if (!doc) return null;

  if (doc.photo?.r2Key) {
    const shared = await isPhotoSharedWithOtherPlans(
      doctorId,
      doc.photo.r2Key,
      doc._id,
    );
    if (!shared) {
      await deletePhotoObject(doc.photo.r2Key);
    }
  }

  return toPlanDTO(doc);
}

export async function duplicatePlan(doctorId, planId, { newLabel } = {}) {
  const original = await SimulationPlan.findOne({
    _id: planId,
    doctorId,
    deletedAt: null,
  });

  if (!original) return null;

  const label =
    newLabel || `${safeDecrypt(original.labelEncrypted, "Plan")} (copy)`;

  const doc = await SimulationPlan.create({
    doctorId,
    planType: original.planType || "face",
    photoView: original.photoView || null,
    labelEncrypted: encrypt(label),
    patientRefEncrypted: original.patientRefEncrypted,
    photo: original.photo,
    controlPoints: original.controlPoints,
    anatomy: original.anatomy,
    operation: original.operation,
    calibration: original.calibration,
    warpTuning: original.warpTuning,
    landmarks: original.landmarks,
    landmarksMeta: original.landmarksMeta,
  });

  return toPlanDTO(doc);
}

export async function isPhotoSharedWithOtherPlans(
  doctorId,
  r2Key,
  excludePlanId,
) {
  const count = await SimulationPlan.countDocuments({
    doctorId,
    "photo.r2Key": r2Key,
    _id: { $ne: excludePlanId },
    deletedAt: null,
  });
  return count > 0;
}

export async function listBreastPlansGroupedByPatient(
  doctorId,
  { limit = 100, includeDeleted = false } = {},
) {
  const query = { doctorId, planType: "breast" };
  if (!includeDeleted) query.deletedAt = null;

  const docs = await SimulationPlan.find(query)
    .sort({ _id: -1 })
    .limit(limit)
    .lean();

  const groups = new Map();
  for (const doc of docs) {
    const patientRef =
      safeDecrypt(doc.patientRefEncrypted, "") || "(no patient)";
    if (!groups.has(patientRef)) {
      groups.set(patientRef, []);
    }
    groups.get(patientRef).push(toPlanDTO(doc));
  }

  return Array.from(groups.entries()).map(([patientRef, plans]) => ({
    patientRef,
    plans,
  }));
}
