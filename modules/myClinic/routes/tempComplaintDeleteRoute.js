import { Router } from "express";

import deleteTempComplaint from "../controllers/deleteTempComplaint.js";

const router = Router();

router.delete("/:id", deleteTempComplaint);

export default router;
