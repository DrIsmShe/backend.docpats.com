// modules/clinic/clinic-medical/routes/allergy.routes.js
//
// Allergy sub-record routes — wires service + controller + router factory.
// Sprint 2 Phase 2C.
//
// Final URLs (mounted at /medical):
//   POST   /medical/patients/:patientId/allergies
//   GET    /medical/patients/:patientId/allergies
//   GET    /medical/allergies/:recordId
//   PATCH  /medical/allergies/:recordId
//   DELETE /medical/allergies/:recordId

import allergyService from "../services/allergy.service.js";
import { buildSubRecordController } from "../controllers/subRecord.controller.factory.js";
import { buildSubRecordRouter } from "./subRecord.routes.factory.js";
import { ACTIONS } from "../rbac/clinicMedicalRBAC.js";
import {
  createAllergySchema,
  updateAllergySchema,
} from "../validators/subRecords.schemas.js";

const allergyController = buildSubRecordController({
  service: allergyService,
  createSchema: createAllergySchema,
  updateSchema: updateAllergySchema,
  label: "allergy",
});

const allergyRouter = buildSubRecordRouter({
  resourcePath: "allergies",
  resourceType: "clinic-medical-allergy",
  actions: {
    create: ACTIONS.ALLERGY.CREATE,
    read: ACTIONS.ALLERGY.READ,
    list: ACTIONS.ALLERGY.LIST,
    update: ACTIONS.ALLERGY.UPDATE,
    delete: ACTIONS.ALLERGY.DELETE,
  },
  controller: allergyController,
});

export default allergyRouter;
