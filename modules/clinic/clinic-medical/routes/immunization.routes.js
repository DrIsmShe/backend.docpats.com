// modules/clinic/clinic-medical/routes/immunization.routes.js
// Immunization sub-record routes. Sprint 2 Phase 2C.

import immunizationService from "../services/immunization.service.js";
import { buildSubRecordController } from "../controllers/subRecord.controller.factory.js";
import { buildSubRecordRouter } from "./subRecord.routes.factory.js";
import { ACTIONS } from "../rbac/clinicMedicalRBAC.js";
import {
  createImmunizationSchema,
  updateImmunizationSchema,
} from "../validators/subRecords.schemas.js";

const controller = buildSubRecordController({
  service: immunizationService,
  createSchema: createImmunizationSchema,
  updateSchema: updateImmunizationSchema,
  label: "immunization",
});

const immunizationRouter = buildSubRecordRouter({
  resourcePath: "immunizations",
  resourceType: "clinic-medical-immunization",
  actions: {
    create: ACTIONS.IMMUNIZATION.CREATE,
    read: ACTIONS.IMMUNIZATION.READ,
    list: ACTIONS.IMMUNIZATION.LIST,
    update: ACTIONS.IMMUNIZATION.UPDATE,
    delete: ACTIONS.IMMUNIZATION.DELETE,
  },
  controller,
});

export default immunizationRouter;
