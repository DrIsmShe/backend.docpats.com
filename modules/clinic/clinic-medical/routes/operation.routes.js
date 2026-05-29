// modules/clinic/clinic-medical/routes/operation.routes.js
// Past operations sub-record routes. Sprint 2 Phase 2C.

import operationService from "../services/operation.service.js";
import { buildSubRecordController } from "../controllers/subRecord.controller.factory.js";
import { buildSubRecordRouter } from "./subRecord.routes.factory.js";
import { ACTIONS } from "../rbac/clinicMedicalRBAC.js";
import {
  createOperationSchema,
  updateOperationSchema,
} from "../validators/subRecords.schemas.js";

const controller = buildSubRecordController({
  service: operationService,
  createSchema: createOperationSchema,
  updateSchema: updateOperationSchema,
  label: "operation",
});

const operationRouter = buildSubRecordRouter({
  resourcePath: "operations",
  resourceType: "clinic-medical-operation",
  actions: {
    create: ACTIONS.OPERATION.CREATE,
    read: ACTIONS.OPERATION.READ,
    list: ACTIONS.OPERATION.LIST,
    update: ACTIONS.OPERATION.UPDATE,
    delete: ACTIONS.OPERATION.DELETE,
  },
  controller,
});

export default operationRouter;
