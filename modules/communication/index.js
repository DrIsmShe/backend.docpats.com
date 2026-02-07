import { Router } from "express";
import communicationPingdRoutes from "./routes/communicationPingdRoutes.js";

import communicationRoutes from "./routes/communicationRoutes.js";
const router = Router();

router.use("/ping", communicationPingdRoutes);
router.use("/", communicationRoutes);

export default router;
