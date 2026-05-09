// modules/clinic/clinic-core/routes/clinic.routes.js

import express from "express";
import * as ctrl from "../controllers/clinic.controller.js";
import clinicCoreRouter from "./clinic-core/routes/clinic.routes.js";
const router = express.Router();

// POST /clinics — create new clinic (auto-owner)
// Public to authenticated users (any user can create their own clinic)
// router.post("/clinics", ctrl.createClinic);

router.use("/", clinicCoreRouter);

// GET /clinics/me — current user's clinic
router.get("/clinics/me", ctrl.getMyClinic);

// PATCH /clinics/:id — update clinic
router.patch("/clinics/:id", ctrl.updateClinic);

// GET /public/:slug — public clinic page (no auth)
router.get("/public/:slug", ctrl.getPublicClinic);

export default router;
