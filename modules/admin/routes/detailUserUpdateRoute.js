import { Router } from "express";
import isAdminRoute from "./isAdminRoute.js";
import detailUserUpdateController from "../controllers/detailUserUpdateController.js";
const router = Router();

router.put("/:userId", isAdminRoute, detailUserUpdateController);
export default router;
