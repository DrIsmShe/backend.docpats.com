import express from "express";
import { myArticleScientificSingleController } from "../controllers/myArticleScientificSingleController.js";
import { resolveLanguage } from "../../../common/middlewares/resolveLanguage.js";

const router = express.Router();

router.get("/:id", resolveLanguage, myArticleScientificSingleController);

export default router;
