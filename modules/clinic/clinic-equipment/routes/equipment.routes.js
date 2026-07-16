// server/modules/clinic/clinic-equipment/routes/equipment.routes.js
//
// Routes for ClinicEquipment. Mounted in clinic/index.js via
// `router.use("/", clinicEquipmentRouter)`, so the full /equipment prefix lives
// here. RBAC проверяется здесь через requireClinicPerm("equipment", ...).
// Раньше проверки не было — любая роль могла править оборудование.

import express from "express";
import * as ctrl from "../controllers/equipment.controller.js";
import { requireClinicPerm } from "../../../../common/middlewares/requireClinicPerm.js";

const router = express.Router();

router.get("/equipment", requireClinicPerm("equipment", "read"), ctrl.listEquipmentController);
router.post("/equipment", requireClinicPerm("equipment", "write"), ctrl.createEquipmentController);
router.get("/equipment/:id", requireClinicPerm("equipment", "read"), ctrl.getEquipmentController);
router.patch("/equipment/:id", requireClinicPerm("equipment", "write"), ctrl.updateEquipmentController);
router.delete("/equipment/:id", requireClinicPerm("equipment", "delete"), ctrl.archiveEquipmentController);

export default router;
