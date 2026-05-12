// server/modules/clinic/clinic-patients/routes/patient.routes.js
//
// REST endpoints for ClinicPatient CRUD + search + link.
//
// Mount path (from parent clinic router): /api/v1/clinic/*
// Final URLs:
//   GET    /api/v1/clinic/patients/search
//   GET    /api/v1/clinic/patients
//   POST   /api/v1/clinic/patients
//   GET    /api/v1/clinic/patients/:id
//   PATCH  /api/v1/clinic/patients/:id
//   DELETE /api/v1/clinic/patients/:id
//   POST   /api/v1/clinic/patients/:id/link
//   DELETE /api/v1/clinic/patients/:id/link
//
// tenantMiddleware and session middleware are applied at the parent
// router level — we don't repeat them here.

import express from "express";
import * as ctrl from "../controllers/patient.controller.js";

const router = express.Router();

// Search MUST come before /patients/:id — otherwise "search" is matched as :id
router.get("/patients/search", ctrl.searchPatients);

// Collection
router.get("/patients", ctrl.listPatients);
router.post("/patients", ctrl.createPatient);

// Single resource
router.get("/patients/:id", ctrl.getPatient);
router.patch("/patients/:id", ctrl.updatePatient);
router.delete("/patients/:id", ctrl.deletePatient);

// Linking to DocPats user account
router.post("/patients/:id/link", ctrl.linkPatient);
router.delete("/patients/:id/link", ctrl.unlinkPatient);

export default router;
