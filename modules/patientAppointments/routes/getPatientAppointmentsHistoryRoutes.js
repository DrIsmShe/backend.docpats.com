// modules/patientAppointments/index.js
import express from "express";
import { getPatientAppointmentsHistoryController } from "../controllers//getPatientAppointmentsHistoryController.js";
import authMiddleware from "../../../common/middlewares/authMiddleware.js";

const router = express.Router();

// История всех приёмов
router.get("/", authMiddleware, getPatientAppointmentsHistoryController);

export default router;
