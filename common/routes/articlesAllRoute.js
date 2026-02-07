import { Router } from "express";
import articlesAllController from "../../controllers/common/articlesAllController.js";
const router = Router();

router.get("/", articlesAllController);

export default router;
