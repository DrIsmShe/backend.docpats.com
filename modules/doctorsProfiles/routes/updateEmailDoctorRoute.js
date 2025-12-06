import { Router } from "express";
import updateEmailController from "../controllers/updateEmailController.js";
const router = Router();

router.put("/", updateEmailController);

export default router;
