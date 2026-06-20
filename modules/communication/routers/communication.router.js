// server/src/communication/communication.router.js

import { Router } from "express";

import videoRoutes from "../video/video.routes.js";
import blockRoutes from "../block/block.routes.js";
const router = Router();

router.use("/block", blockRoutes);
router.use("/video", videoRoutes);

export default router;
