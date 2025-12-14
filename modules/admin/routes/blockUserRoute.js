import { Router } from "express";
import blockUserController from "../controllers/blockUserController.js";
const router = Router();

router.post("/:id", blockUserController);
export default router;
