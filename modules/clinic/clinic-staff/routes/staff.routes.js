// modules/clinic/clinic-staff/routes/staff.routes.js

import express from "express";
import * as ctrl from "../controllers/staff.controller.js";

const router = express.Router();

// Search doctors (must come before /staff to not collide with /:id patterns elsewhere)
router.get("/staff/search-doctors", ctrl.searchDoctors);

// GET /staff — list staff (with decrypted PII)
router.get("/staff", ctrl.listStaff);

// POST /staff — add existing user as staff
router.post("/staff", ctrl.addStaff);

// PATCH /staff/:id/role — change role
router.patch("/staff/:id/role", ctrl.updateStaffRole);

// DELETE /staff/:id — soft-remove staff
router.delete("/staff/:id", ctrl.removeStaff);

export default router;
