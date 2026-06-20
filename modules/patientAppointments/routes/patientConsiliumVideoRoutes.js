// server/modules/patientAppointments/routes/patientConsiliumVideoRoutes.js
//
// Patient-side consilium routes. authMiddleware (session) is applied here; no
// clinic membership required.
//
// Mounted in patientAppointments index under /consilium-video:
//   GET  /appointment-for-patient/consilium-video/my                      → my consilia
//   POST /appointment-for-patient/consilium-video/:consiliumId/video-token → room token

import express from "express";
import authMiddleware from "../../../common/middlewares/authvalidateMiddleware/authMiddleware.js";
import { issuePatientConsiliumVideoTokenController } from "../controllers/patientConsiliumVideo.controller.js";
import { getMyConsiliaController } from "../controllers/patientConsiliumList.controller.js";

const router = express.Router();

// Specific route BEFORE the parameterized one.
router.get("/my", authMiddleware, getMyConsiliaController);

router.post(
  "/:consiliumId/video-token",
  authMiddleware,
  issuePatientConsiliumVideoTokenController,
);

export default router;
