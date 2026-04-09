import { Router } from "express";
import profileUpdatePatientController from "../controllers/profileUpdatePatientController.js";
import {
  upload,
  resizeImage,
} from "../../../common/middlewares/uploadMiddleware.js";
const router = Router();

router.post(
  "/",
  upload.single("image"),
  resizeImage,
  profileUpdatePatientController
);
export default router;
