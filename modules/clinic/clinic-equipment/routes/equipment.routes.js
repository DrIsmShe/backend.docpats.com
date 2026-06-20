// server/modules/clinic/clinic-equipment/routes/equipment.routes.js
//
// Routes for ClinicEquipment. Mounted in clinic/index.js via
// `router.use("/", clinicEquipmentRouter)`, so the full /equipment prefix
// lives here. No requirePermission middleware — RBAC is handled the same
// way as clinic-departments / clinic-rooms (tenantMiddleware upstream +
// frontend button-hiding).

import express from "express";
import * as ctrl from "../controllers/equipment.controller.js";

const router = express.Router();

router.get("/equipment", ctrl.listEquipmentController);
router.post("/equipment", ctrl.createEquipmentController);
router.get("/equipment/:id", ctrl.getEquipmentController);
router.patch("/equipment/:id", ctrl.updateEquipmentController);
router.delete("/equipment/:id", ctrl.archiveEquipmentController);

export default router;
