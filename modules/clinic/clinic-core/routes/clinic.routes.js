// modules/clinic/clinic-core/routes/clinic.routes.js

import express from "express";
import * as ctrl from "../controllers/clinic.controller.js";

const router = express.Router();

// POST /clinics — create new clinic (auto-owner)
router.post("/clinics", ctrl.createClinic);

// GET /clinics/me — current user's clinic
router.get("/clinics/me", ctrl.getMyClinic);

// PATCH /clinics/:id — update clinic
router.patch("/clinics/:id", ctrl.updateClinic);

// GET /public/:slug — public clinic page (no auth)
router.get("/public/:slug", ctrl.getPublicClinic);

export default router;
