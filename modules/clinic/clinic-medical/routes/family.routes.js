// modules/clinic/clinic-medical/routes/family.routes.js
// Family history sub-record routes. Sprint 2 Phase 2C.

import familyService from "../services/family.service.js";
import { buildSubRecordController } from "../controllers/subRecord.controller.factory.js";
import { buildSubRecordRouter } from "./subRecord.routes.factory.js";
import { ACTIONS } from "../rbac/clinicMedicalRBAC.js";
import {
  createFamilyHistorySchema,
  updateFamilyHistorySchema,
} from "../validators/subRecords.schemas.js";

const controller = buildSubRecordController({
  service: familyService,
  createSchema: createFamilyHistorySchema,
  updateSchema: updateFamilyHistorySchema,
  label: "family history",
});

const familyRouter = buildSubRecordRouter({
  resourcePath: "family-history",
  resourceType: "clinic-medical-family-history",
  actions: {
    create: ACTIONS.FAMILY.CREATE,
    read: ACTIONS.FAMILY.READ,
    list: ACTIONS.FAMILY.LIST,
    update: ACTIONS.FAMILY.UPDATE,
    delete: ACTIONS.FAMILY.DELETE,
  },
  controller,
});

export default familyRouter;
