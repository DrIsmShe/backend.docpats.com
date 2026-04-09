import { Router } from "express";
import myArticleScientificDoctorController from "../controllers/myArticleScientificDoctorController.js";
const router = Router();

router.get("/", myArticleScientificDoctorController);

export default router;
