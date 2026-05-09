// modules/clinic/clinic-staff/routes/staff.routes.js

import express from "express";
import * as ctrl from "../controllers/staff.controller.js";

const router = express.Router();

router.get("/staff", ctrl.listStaff);
router.post("/staff", ctrl.addStaff);
router.patch("/staff/:id/role", ctrl.updateStaffRole);
router.delete("/staff/:id", ctrl.removeStaff);

export default router;
