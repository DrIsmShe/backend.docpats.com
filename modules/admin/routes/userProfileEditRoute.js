import express from "express";
import { userProfileEditController } from "../controllers/userProfileEditController.js";
import { requireAdmin } from "../routes/isAdminRoute.js";

const router = express.Router();
router.patch("/profile/:userId", requireAdmin, userProfileEditController);
export default router;
