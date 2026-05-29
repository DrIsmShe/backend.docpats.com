// modules/clinic/clinic-medical/services/allergy.service.js
//
// Allergy sub-record service — thin config over subRecordBase.
// Sprint 2 Phase 2C.
//
// Model fields specific to allergy: content (string, required).

import AllergiesPatient from "../../../../common/models/Polyclinic/MedicalHistory/allergiesPatient.js";
import { buildSubRecordService } from "./subRecordBase.service.js";
import { EVENTS } from "../../../../common/events/eventBus.js";

const allergyService = buildSubRecordService({
  Model: AllergiesPatient,
  scope: "allergies",

  // No dedicated allergy events in EVENTS enum — use generic medical
  // events or null. We keep null for now; audit log covers traceability.
  events: {
    created: null,
    updated: null,
    deleted: null,
  },

  // Map request body → model content fields.
  // partial=true during UPDATE (only present fields are returned).
  mapBody(body, { partial = false } = {}) {
    const out = {};
    if (!partial || Object.prototype.hasOwnProperty.call(body, "content")) {
      out.content = body.content;
    }
    return out;
  },

  // Add allergy-specific fields to response shape
  shapeExtra(doc) {
    return { content: doc.content || null };
  },
});

export default allergyService;
