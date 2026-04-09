import { Router } from "express";
import dialogRoutes from "./dialogs/dialog.routes.js";
import messageRoutes from "./messages/message.routes.js";
import translationRoutes from "./chat-translation/messageTranslation.routes.js";
import blockRoutes from "./routers/communication.router.js";

const router = Router();

router.use("/dialogs", dialogRoutes);
router.use("/messages", messageRoutes);
router.use("/translations", translationRoutes); // ← ДОБАВИТЬ
router.use("/", blockRoutes);

export default router;
