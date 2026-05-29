// modules/clinic/clinic-medical/services/immunization.service.js
//
// Immunization sub-record service. Sprint 2 Phase 2C.
// Fields: vaccineName (required), dateGiven (optional Date), content (optional).

import ImmunizationPatient from "../../../../common/models/Polyclinic/MedicalHistory/immunizationPatient.js";
import { buildSubRecordService } from "./subRecordBase.service.js";

const immunizationService = buildSubRecordService({
  Model: ImmunizationPatient,
  scope: "immunization",
  events: { created: null, updated: null, deleted: null },

  mapBody(body, { partial = false } = {}) {
    const out = {};
    const has = (k) => Object.prototype.hasOwnProperty.call(body, k);

    if (!partial || has("vaccineName")) out.vaccineName = body.vaccineName;
    if (has("dateGiven")) out.dateGiven = body.dateGiven; // model defaults to now
    if (!partial || has("content")) out.content = body.content ?? "";

    return out;
  },

  shapeExtra(doc) {
    return {
      vaccineName: doc.vaccineName || null,
      dateGiven: doc.dateGiven || null,
      content: doc.content || null,
    };
  },
});

export default immunizationService;
