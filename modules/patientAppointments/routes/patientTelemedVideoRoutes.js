// server/modules/patientAppointments/routes/patientTelemedVideoRoutes.js
//
// Patient-side telemed routes. authMiddleware (session) is applied here; no
// clinic membership required.
//
// Mounted in patientAppointments/index.js under /telemed-video:
//   GET  /appointment-for-patient/telemed-video/my                 → my sessions
//   POST /appointment-for-patient/telemed-video/:sessionId/video-token → room token

import express from "express";
import authMiddleware from "../../../common/middlewares/authvalidateMiddleware/authMiddleware.js";
import { issuePatientTelemedVideoTokenController } from "../controllers/patientTelemedVideo.controller.js";
import { listPatientTelemedSessionsController } from "../controllers/patientTelemedList.controller.js";

const router = express.Router();

// Specific route BEFORE the parameterized one.
router.get("/my", authMiddleware, listPatientTelemedSessionsController);

router.post(
  "/:sessionId/video-token",
  authMiddleware,
  issuePatientTelemedVideoTokenController,
);

export default router;
