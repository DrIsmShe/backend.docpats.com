import { Router } from "express";
import deleteUserController from "../controllers/deleteUserController.js";
const router = Router();

router.post("/:id", deleteUserController);
export default router;
