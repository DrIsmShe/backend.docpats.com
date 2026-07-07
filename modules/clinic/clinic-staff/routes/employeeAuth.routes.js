// modules/clinic/clinic-staff/routes/employeeAuth.routes.js
//
// Routes for ClinicEmployee authentication (Global Clinic Worker model).
//
// All endpoints live under /api/v1/clinic/employees/* (mounted in modules/clinic/index.js).
//
// POST /login          — public: email + password → session (+ auto-select
//                        clinic when the worker belongs to exactly one; else
//                        returns needsClinicSelection + list of clinics)
// POST /select-clinic  — authenticated: pick which clinic to work in
//                        (multi-clinic workers) → sets session.clinicId
// POST /logout          — clears the employee identity from the session
// GET  /me              — current worker + selected clinic context

import express from "express";
import * as authController from "../controllers/employeeAuth.controller.js";

const router = express.Router();

router.post("/employees/login", authController.login);
router.post("/employees/select-clinic", authController.selectClinic);
router.post("/employees/logout", authController.logout);
router.get("/employees/me", authController.me);

export default router;
