import express from "express";
const router = express.Router();

import slotsRoute from "./routes/slotsRoute.js";
import createRoute from "./routes/createRoute.js";
import confirmRoute from "./routes/confirmRoute.js";
import canceldRoute from "./routes/canceldRoute.js";
import completeRoute from "./routes/completeRoute.js";
import noshowRoute from "./routes/noshowRoute.js";
import doctorscheduleRoute from "./routes/doctorscheduleRoute.js";
//import appointmentsIdRoute from "./routes/appointmentsIdRoute.js";
import myroleRoute from "./routes/myroleRoute.js";
import updateVideoSessionRoute from "./routes/updateVideoSessionRoute.js";

router.use("/video-session", updateVideoSessionRoute); // GET
router.use("/slots/:doctorId?from=YYYY-MM-DD&to=YYYY-MM-DD", slotsRoute); // GET
router.use("/create", createRoute); // POST // create {doctorId, patientId, startsAt, endsAt, type, notesPatient}
router.use("/:id/confirm", confirmRoute); // POST
router.use("/:id/cancel", canceldRoute); // POST
router.use("/:id/complete", completeRoute); // POST
router.use("/:id/noshow", noshowRoute); // POST upsert weekly/exceptions/settings
router.use("/doctor-schedule/:doctorId ", doctorscheduleRoute); // PUT
//router.use("/:id", appointmentsIdRoute); // GET

router.use("/my?role=patient|doctor&status=...", myroleRoute); // GET
// система auth USER end
export default router;
