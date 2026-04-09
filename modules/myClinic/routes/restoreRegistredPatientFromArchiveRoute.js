import { Router } from "express";
import restoreRegistredPatientController from "../controllers/restoreRegistredPatientController.js";
import authMidleWeare from "../../../common/middlewares/authMiddleware.js";
import resolvePatient from "../../../common/middlewares/resolvePatient.js";
const router = Router();

router.patch(
  "/:id/restore",
  authMidleWeare,
  resolvePatient,
  restoreRegistredPatientController,
);
export default router;
