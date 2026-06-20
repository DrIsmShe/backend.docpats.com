// server/modules/appointments/routes/appointmentVideoRoute.js
//
// Route for issuing a freelance appointment video token. authMiddleware is
// applied here explicitly so req.userId AND req.user.patientPolyclinicId are
// always available (the patient branch of authorization needs the latter).
//
// Mounted alongside the existing video-session route — see appointments
// index.js. Full path ends with /:appointmentId/token.

import { Router } from "express";
import authMiddleware from "../../../common/middlewares/authMiddleware.js";
import { issueAppointmentVideoTokenController } from "../controllers/appointmentVideo.controller.js";

const router = Router();

router.post(
  "/:appointmentId/token",
  authMiddleware,
  issueAppointmentVideoTokenController,
);

export default router;
