import { Router } from "express";
import countAllArticlesForPatientController from "../controllers/countAllArticlesForPatientController.js";
const router = Router();

router.get("/count-articles-all", countAllArticlesForPatientController);

export default router;
