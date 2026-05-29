// modules/clinic/clinic-medical/services/chronic.service.js
//
// Chronic disease sub-record service. Sprint 2 Phase 2C.
// Fields: content (string, required) — same shape as allergy.

import ChronicDiseasesPatient from "../../../../common/models/Polyclinic/MedicalHistory/chronicDiseasesPatient.js";
import { buildSubRecordService } from "./subRecordBase.service.js";

const chronicService = buildSubRecordService({
  Model: ChronicDiseasesPatient,
  scope: "chronicDiseases",
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

export default chronicService;
