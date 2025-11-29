import { Router } from "express";
import countArticlesTodayController from "../controllers/countArticlesTodayController.js";
const router = Router();

router.get("/count-articles-today", countArticlesTodayController);

export default router;
