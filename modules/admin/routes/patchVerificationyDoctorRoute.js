import { Router } from "express";
import PatchVerificationyDoctorController from "../controllers/patchVerificationyDoctorController.js";
import GetDoctorVerificationDocumentsController from "../controllers/getDoctorVerificationDocumentsController.js";
import { updateVerificationDocumentController } from "../controllers/updateVerificationDocumentController.js";

import isAdminRoute from "../routes/isAdminRoute.js";
const router = Router();

// Маршрут для изменения роли пользователя
router.put("/doctor/:doctorProfileId", PatchVerificationyDoctorController);

router.get(
  "/doctor/:doctorId",
  isAdminRoute,
  GetDoctorVerificationDocumentsController,
);

router.patch(
  "/document/:id",
  isAdminRoute,
  updateVerificationDocumentController,
);
export default router;
