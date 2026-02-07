import { Router } from "express";
import AllDoctorArticlesController from "../controllers/AllDoctorArticlesController.js";
const router = Router();

router.get("/:id", AllDoctorArticlesController);

export default router;
