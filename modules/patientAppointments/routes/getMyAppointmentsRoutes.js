import express from "express";
import { getMyAppointmentsController } from "../controllers/getMyAppointmentsController.js";
import authMiddleware from "../../../common/middlewares/authvalidateMiddleware/authMiddleware.js";

const router = express.Router();
router.get("/", authMiddleware, getMyAppointmentsController);
export default router;
