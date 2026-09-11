import { Router } from "express";
import PatchVerificationyDoctorController from "../controllers/patchVerificationyDoctorController.js";
import GetDoctorVerificationDocumentsController from "../controllers/getDoctorVerificationDocumentsController.js";
import { updateVerificationDocumentController } from "../controllers/updateVerificationDocumentController.js";
import {
  extendVerificationController,
  restoreVerificationController,
} from "../controllers/extendVerificationController.js";

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

/* Продление и восстановление допуска.
 *
 * Объявлены ПОСЛЕ "/doctor/:doctorProfileId", и это не случайность:
 * Express перебирает маршруты сверху вниз, но "/doctor/:id" —
 * двухсегментный шаблон, а эти трёхсегментные, так что перехвата не
 * будет ни в каком порядке. Порядок здесь — для чтения: сначала обычное
 * решение, потом исключения из него. */
router.put(
  "/doctor/:doctorProfileId/extend",
  isAdminRoute,
  extendVerificationController,
);
router.put(
  "/doctor/:doctorProfileId/restore",
  isAdminRoute,
  restoreVerificationController,
);
export default router;
