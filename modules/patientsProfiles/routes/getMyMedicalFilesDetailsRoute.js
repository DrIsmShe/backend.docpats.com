import { Router } from "express";
import getMyMedicalFilesDetailsController from "../controllers/getMyMedicalFilesDetailsController.js";
import authMiddleware from "../../../common/middlewares/authMiddleware.js"; // обязательно!

const router = Router();

router.get(
  "/files/:patientId",
  authMiddleware,
  getMyMedicalFilesDetailsController
); // ✅ добавляем промеж authMiddleware

export default router;
