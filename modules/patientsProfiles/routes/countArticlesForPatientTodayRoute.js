import { Router } from "express";
import countArticlesForPatientTodayController from "../controllers/countArticlesForPatientTodayController.js";
const router = Router();

router.get("/count-articles-today", countArticlesForPatientTodayController);

export default router;
