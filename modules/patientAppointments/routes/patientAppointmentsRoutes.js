import express from "express";
import { bookAppointment } from "../controllers/patientAppointmentsController.js";
import authMiddleware from "../../../common/middlewares/authvalidateMiddleware/authMiddleware.js";

const router = express.Router();
router.post("/", authMiddleware, bookAppointment);
export default router;
