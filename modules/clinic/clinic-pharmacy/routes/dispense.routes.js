// server/modules/clinic/clinic-pharmacy/routes/dispense.routes.js
//
// Route for dispensing (выдача). PRIVATE — tenantMiddleware upstream;
// permission gates (INVENTORY WRITE, + PRESCRIPTION READ for patient target)
// live in the controller. Path declared here, router mounted at "/" in
// clinic-pharmacy/index.js.

import express from "express";
import { dispense } from "../controllers/dispense.controller.js";

const router = express.Router();

router.post("/pharmacy/dispense", dispense);

export default router;
