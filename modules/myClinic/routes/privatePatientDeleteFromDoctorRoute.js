import { Router } from "express";
import privatePatientDeleteFromDoctorontroller from "../controllers/privatePatientDeleteFromDoctorontroller.js";
import authMidleWeare from "../../../common/middlewares/authMiddleware.js";
import resolvePatient from "../../../common/middlewares/resolvePatient.js";
const router = Router();

router.delete(
  "/private-patient/:id",
  authMidleWeare,
  resolvePatient,
  privatePatientDeleteFromDoctorontroller,
);
export default router;
