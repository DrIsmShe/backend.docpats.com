// routes/DoctorRecommendRoute.js
import express from "express";
import doctorRecommendToggleController from "../controllers/doctorRecommendToggleController.js";

const router = express.Router();

// POST /patient-profile/doctor/:id/recommend
router.post("/:id/recommend", doctorRecommendToggleController);

export default router;
