// server/modules/patientAppointments/routes/appointmentVideoRoutes.js
//
// Route for issuing a freelance appointment video token. authMiddleware is
// applied here (same import path the other routes in this module use) so
// req.userId AND req.user.patientPolyclinicId are available — the patient
// branch of authorization needs the latter.
//
// Mounted in patientAppointments/index.js under /video → final path:
//   POST /appointment-for-patient/video/:appointmentId/token

import express from "express";
import authMiddleware from "../../../common/middlewares/authvalidateMiddleware/authMiddleware.js";
import { issueAppointmentVideoTokenController } from "../controllers/appointmentVideo.controller.js";

const router = express.Router();

router.post(
  "/:appointmentId/token",
  authMiddleware,
  issueAppointmentVideoTokenController,
);

export default router;
