// server/modules/clinic/clinic-leads/services/lead.service.js
//
// Business logic for clinic leads (contact requests from the public vitrina).
//
// Two audiences, two trust levels:
//   • createLead — called from the PUBLIC endpoint by an unauthenticated
//     visitor. It resolves clinicId from the clinic's slug (published clinics
//     only), so the caller can never target a clinic by forging an id. All
//     visitor input is validated/clamped here before it touches the DB.
//   • listLeads / updateLeadStatus — called from the PRIVATE (manager) side.
//     They take clinicId as an explicit argument (the controller pulls it from
//     the tenant context). Every query is scoped by clinicId — leads never
//     leak across clinics.
//
// Errors carry a statusCode so the central errorHandler maps them to the right
// HTTP status (mirrors the pattern in review.service.js).

import mongoose from "mongoose";

import Clinic from "../../clinic-core/models/clinic.model.js";
import Lead, {
  LEAD_TYPE_VALUES,
  LEAD_STATUS_VALUES,
} from "../models/lead.model.js";
import { notifyClinicManagersOfLead } from "./leadNotify.service.js";

function badRequest(message) {
  const e = new Error(message);
  e.statusCode = 400;
  return e;
}

function notFound(message) {
  const e = new Error(message);
  e.statusCode = 404;
  return e;
}

// ─── Public: create a lead from the vitrina ───────────────────
export async function createLead({ slug, name, phone, message, type } = {}) {
  if (!slug || typeof slug !== "string") {
    throw badRequest("slug is required");
  }

  const cleanName = typeof name === "string" ? name.trim() : "";
  const cleanPhone = typeof phone === "string" ? phone.trim() : "";
  const cleanMessage = typeof message === "string" ? message.trim() : "";

  if (!cleanName) throw badRequest("name is required");
  if (!cleanPhone) throw badRequest("phone is required");
  if (cleanName.length > 200) throw badRequest("name is too long");
  if (cleanPhone.length > 40) throw badRequest("phone is too long");
  if (cleanMessage.length > 2000) throw badRequest("message is too long");

  const leadType = LEAD_TYPE_VALUES.includes(type) ? type : "message";

  const clinic = await Clinic.findOne({ slug, isPublished: true })
    .select("_id")
    .lean();

  if (!clinic) {
    throw notFound("Clinic not found");
  }

  const lead = await Lead.create({
    clinicId: clinic._id,
    name: cleanName,
    phone: cleanPhone,
    message: cleanMessage,
    type: leadType,
    status: "new",
    source: "vitrina",
  });

  // fire-and-forget: уведомление клиники (in-app + email) не должно влиять
  // на публичный ответ гостю — createLead всегда отдаёт 201.
  notifyClinicManagersOfLead(clinic._id, lead).catch((err) =>
    console.error("[lead] notification failed:", err?.message),
  );

  return lead.toObject();
}

// ─── Private: list leads for a clinic ─────────────────────────
export async function listLeads({ clinicId, status, limit, skip } = {}) {
  if (!clinicId || !mongoose.isValidObjectId(clinicId)) {
    throw badRequest("valid clinicId is required");
  }

  const filter = { clinicId: new mongoose.Types.ObjectId(String(clinicId)) };
  if (status && LEAD_STATUS_VALUES.includes(status)) {
    filter.status = status;
  }

  const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const off = Math.max(parseInt(skip, 10) || 0, 0);

  const [leads, total] = await Promise.all([
    Lead.find(filter).sort({ createdAt: -1 }).skip(off).limit(lim).lean(),
    Lead.countDocuments(filter),
  ]);

  return { leads, total };
}

// ─── Private: update a lead's status ──────────────────────────
export async function updateLeadStatus({
  clinicId,
  leadId,
  status,
  note,
  membershipId,
} = {}) {
  if (!clinicId || !mongoose.isValidObjectId(clinicId)) {
    throw badRequest("valid clinicId is required");
  }
  if (!leadId || !mongoose.isValidObjectId(leadId)) {
    throw badRequest("valid leadId is required");
  }
  if (!LEAD_STATUS_VALUES.includes(status)) {
    throw badRequest(`status must be one of: ${LEAD_STATUS_VALUES.join(", ")}`);
  }

  const update = {
    status,
    handledAt: new Date(),
  };
  if (membershipId && mongoose.isValidObjectId(membershipId)) {
    update.handledByMembershipId = new mongoose.Types.ObjectId(
      String(membershipId),
    );
  }
  if (typeof note === "string") {
    update.note = note.trim().slice(0, 1000);
  }

  const lead = await Lead.findOneAndUpdate(
    {
      _id: new mongoose.Types.ObjectId(String(leadId)),
      clinicId: new mongoose.Types.ObjectId(String(clinicId)),
    },
    { $set: update },
    { new: true },
  ).lean();

  if (!lead) {
    throw notFound("Lead not found");
  }

  return lead;
}

export default { createLead, listLeads, updateLeadStatus };
