// server/modules/clinic/clinic-departments/index.js
//
// Aggregator router for the clinic-departments submodule.
// Exposes department CRUD. Mounted in clinic/index.js at "/".
//
// Routes are defined with the full "/departments" prefix inside
// department.routes.js (staff.routes.js style), so this is mounted
// at "/" — NOT at "/departments".

import express from "express";
import departmentRoutes from "./routes/department.routes.js";

const router = express.Router();

router.use("/", departmentRoutes);

export default router;
