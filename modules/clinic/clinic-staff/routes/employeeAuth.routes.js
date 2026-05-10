// modules/clinic/clinic-staff/routes/employeeAuth.routes.js
//
// Routes for ClinicEmployee authentication.
//
// All endpoints live under /api/v1/clinic/employees/* (mounted in modules/clinic/index.js).
//
// POST /login   — public: email + password → session
// POST /logout  — destroys session
// GET  /me      — current employee + clinic context

import express from "express";
import * as authController from "../controllers/employeeAuth.controller.js";

const router = express.Router();

router.post("/employees/login", authController.login);
router.post("/employees/logout", authController.logout);
router.get("/employees/me", authController.me);

export default router;
