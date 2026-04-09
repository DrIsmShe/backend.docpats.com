import { Router } from "express";
import AllDoctorArticleScientificsController from "../controllers/AllDoctorArticleScientificsController.js";
const router = Router();

router.get("/:id", AllDoctorArticleScientificsController);

export default router;
