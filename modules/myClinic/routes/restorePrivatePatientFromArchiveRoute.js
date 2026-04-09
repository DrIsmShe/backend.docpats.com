import { Router } from "express";
import restorePrivatePatientController from "../controllers/restorePrivatePatientController.js";
import authMidleWeare from "../../../common/middlewares/authMiddleware.js";
import resolvePatient from "../../../common/middlewares/resolvePatient.js";
const router = Router();

router.patch(
  "/private-patient/:id/restore",
  authMidleWeare,
  resolvePatient,
  restorePrivatePatientController,
);
export default router;
