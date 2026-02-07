import { Router } from "express";
import profileUpdateDoctorController from "../controllers/profileUpdateDoctorController.js";
import {
  upload,
  resizeImage,
} from "../../../common/middlewares/uploadMiddleware.js";
const router = Router();

router.post(
  "/",
  upload.single("image"),
  resizeImage,
  profileUpdateDoctorController
);
export default router;
