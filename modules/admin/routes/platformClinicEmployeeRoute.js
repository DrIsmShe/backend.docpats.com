// modules/admin/routes/platformClinicEmployeeRoute.js
//
// Platform-owner route for deleting a global ClinicEmployee identity.
// Guarded by requireAdmin (session.userId → User.role === "admin").
//
// Mounted in modules/admin/index.js, e.g.:
//   import platformClinicEmployeeRoute from "./routes/platformClinicEmployeeRoute.js";
//   router.use("/clinic-workers", platformClinicEmployeeRoute);
//
// → DELETE {adminPrefix}/clinic-workers/:employeeId

import { Router } from "express";
import requireAdmin from "../middlewares/authvalidateMiddleware/requireAdmin.js";
import { deleteClinicWorker } from "../controllers/platformClinicEmployee.controller.js";

const router = Router();

router.delete("/:employeeId", requireAdmin, deleteClinicWorker);

export default router;
