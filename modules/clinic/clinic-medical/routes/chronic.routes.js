// modules/clinic/clinic-medical/routes/chronic.routes.js
// Chronic disease sub-record routes. Sprint 2 Phase 2C.

import chronicService from "../services/chronic.service.js";
import { buildSubRecordController } from "../controllers/subRecord.controller.factory.js";
import { buildSubRecordRouter } from "./subRecord.routes.factory.js";
import { ACTIONS } from "../rbac/clinicMedicalRBAC.js";
import {
  createChronicSchema,
  updateChronicSchema,
} from "../validators/subRecords.schemas.js";

const controller = buildSubRecordController({
  service: chronicService,
  createSchema: createChronicSchema,
  updateSchema: updateChronicSchema,
  label: "chronic disease",
});

const chronicRouter = buildSubRecordRouter({
  resourcePath: "chronic-diseases",
  resourceType: "clinic-medical-chronic-disease",
  actions: {
    create: ACTIONS.CHRONIC.CREATE,
    read: ACTIONS.CHRONIC.READ,
    list: ACTIONS.CHRONIC.LIST,
    update: ACTIONS.CHRONIC.UPDATE,
    delete: ACTIONS.CHRONIC.DELETE,
  },
  controller,
});

export default chronicRouter;
