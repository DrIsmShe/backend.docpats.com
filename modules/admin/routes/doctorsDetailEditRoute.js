import { Router } from "express";
import isAdminRoute from "./isAdminRoute.js";
import { doctorsDetailEditController } from "../controllers/doctorsDetailEditController.js";
const router = Router();

router.patch("/:doctorId", isAdminRoute, doctorsDetailEditController);
export default router;
