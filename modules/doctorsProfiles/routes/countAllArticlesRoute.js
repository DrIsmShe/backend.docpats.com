import { Router } from "express";
import countAllArticlesController from "../controllers/countAllArticlesController.js";
const router = Router();

router.get("/count-all-articles", countAllArticlesController);

export default router;
