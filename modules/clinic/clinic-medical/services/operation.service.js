// modules/clinic/clinic-medical/services/operation.service.js
//
// Past operations sub-record service. Sprint 2 Phase 2C.
// Fields: content (string, required) — same shape as allergy.

import OperationsPatient from "../../../../common/models/Polyclinic/MedicalHistory/operationsPatient.js";
import { buildSubRecordService } from "./subRecordBase.service.js";

const operationService = buildSubRecordService({
  Model: OperationsPatient,
  scope: "operations",
  events: { created: null, updated: null, deleted: null },

  mapBody(body, { partial = false } = {}) {
    const out = {};
    if (!partial || Object.prototype.hasOwnProperty.call(body, "content")) {
      out.content = body.content;
    }
    return out;
  },

  shapeExtra(doc) {
    return { content: doc.content || null };
  },
});

export default operationService;
