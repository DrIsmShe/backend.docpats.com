// server/modules/patientsProfiles/routes/getMyPrescriptionsRoute.js
//
// Пациентские роуты рецептов (read-only). Монтируются из patientsProfiles/index.js.
//
// Финальные URL (если index монтируется под /patient-profile):
//   GET /patient-profile/get-my-prescriptions             — список
//   GET /patient-profile/get-my-prescription-pdf/:id      — PDF одного
//
// authMiddleware кладёт req.userId/req.session.userId — контроллеры берут
// userId оттуда и проверяют владение через ClinicPatient.linkedUserId.

import express from "express";
import authMiddleware from "../../../common/middlewares/authMiddleware.js";
import getMyPrescriptionsController from "../controllers/getMyPrescriptionsController.js";
import getMyPrescriptionPdfController from "../controllers/getMyPrescriptionPdfController.js";

const router = express.Router();

router.get("/", authMiddleware, getMyPrescriptionsController);

export const prescriptionPdfRouter = express.Router();
prescriptionPdfRouter.get(
  "/:id",
  authMiddleware,
  getMyPrescriptionPdfController,
);

export default router;
