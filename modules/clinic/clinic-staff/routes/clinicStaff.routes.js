// modules/clinic/clinic-staff/routes/staff.routes.js

import express from "express";
import * as ctrl from "../controllers/staff.controller.js";

const router = express.Router();

// GET /staff — list staff
router.get("/staff", ctrl.listStaff);

// POST /staff — add existing user as staff
router.post("/staff", ctrl.addStaff);

// PATCH /staff/:id/role — change role
router.patch("/staff/:id/role", ctrl.updateStaffRole);

// DELETE /staff/:id — soft-remove staff
router.delete("/staff/:id", ctrl.removeStaff);

export default router;
