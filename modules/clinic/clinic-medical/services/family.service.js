// modules/clinic/clinic-medical/services/family.service.js
//
// Family history sub-record service. Sprint 2 Phase 2C.
// Fields: relative (required), diseaseName (required), content (optional).

import FamilyHistoryOfDiseasePatient from "../../../../common/models/Polyclinic/MedicalHistory/familyHistoryOfDiseasePatient.js";
import { buildSubRecordService } from "./subRecordBase.service.js";

const familyService = buildSubRecordService({
  Model: FamilyHistoryOfDiseasePatient,
  scope: "familyHistory",
  events: { created: null, updated: null, deleted: null },

  mapBody(body, { partial = false } = {}) {
    const out = {};
    const has = (k) => Object.prototype.hasOwnProperty.call(body, k);

    if (!partial || has("relative")) out.relative = body.relative;
    if (!partial || has("diseaseName")) out.diseaseName = body.diseaseName;
    if (!partial || has("content")) out.content = body.content ?? "";

    return out;
  },

  shapeExtra(doc) {
    return {
      relative: doc.relative || null,
      diseaseName: doc.diseaseName || null,
      content: doc.content || null,
    };
  },
});

export default familyService;
