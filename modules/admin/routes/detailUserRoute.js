import { Router } from "express";
import isAdminRoute from "./isAdminRoute.js";
import detailUserController from "../controllers/detailUserController.js";
const router = Router();

router.get("/:id", isAdminRoute, detailUserController);
export default router;
