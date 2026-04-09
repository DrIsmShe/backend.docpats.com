import { Router } from "express";
import privatePatientDetailsController from "../controllers/privatePatientDetailsController.js";
import authMidleWeare from "../../../common/middlewares/authMiddleware.js";
import resolvePatient from "../../../common/middlewares/resolvePatient.js";
const router = Router();

router.get(
  "/:id",
  authMidleWeare,
  resolvePatient,
  privatePatientDetailsController,
);
export default router;
