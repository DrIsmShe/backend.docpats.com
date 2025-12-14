import { Router } from "express";
import getMyArticlesDoctorController from "../controllers/getMyArticlesDoctorController.js";
const router = Router();

router.get("/", getMyArticlesDoctorController);

export default router;
