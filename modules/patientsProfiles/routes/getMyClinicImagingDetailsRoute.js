// ✅ server/modules/patient-profile/routes/getMyClinicImagingDetailsRoute.js
import { Router } from "express";
import getMyClinicImagingDetailsController from "../controllers/getMyClinicImagingDetailsController.js";
import authMiddleware from "../../../common/middlewares/authMiddleware.js";

const router = Router();

// GET /patient-profile/get-my-clinic-imaging-details/files/:id
router.get("/files/:id", authMiddleware, getMyClinicImagingDetailsController);

export default router;
