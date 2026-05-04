import { Router } from "express";
import countSCIENTIFICAllArticlesController from "../controllers/countSCIENTIFICAllArticlesController.js";
const router = Router();

router.get(
  "/count-scientific-all-articles",
  countSCIENTIFICAllArticlesController,
);

export default router;
