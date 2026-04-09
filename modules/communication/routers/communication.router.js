// server/src/communication/communication.router.js

import { Router } from "express";

import blockRoutes from "../block/block.routes.js";

const router = Router();

router.use("/block", blockRoutes);

export default router;
