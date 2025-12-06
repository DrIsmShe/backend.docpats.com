// modules/patientAppointments/index.js
import express from "express";
import { cancelAppointmentByPatientController } from "../controllers/cancelAppointmentController.js";
import authMiddleware from "../../../common/middlewares/authMiddleware.js";

const router = express.Router();

// Отмена записи
router.put("/:id", authMiddleware, cancelAppointmentByPatientController);

export default router;
