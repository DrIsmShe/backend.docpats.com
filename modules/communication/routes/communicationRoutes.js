import express from "express";
import { createRoomController } from "../controllers/createRoomController.js";
import { addParticipantController } from "../controllers/addParticipantController.js";
import { sendMessageController } from "../controllers/sendMessageController.js";
import { getMessagesController } from "../controllers//getMessagesController.js";
import authMiddleware from "../../../common/middlewares/authMiddleware.js";

import { logCallController } from "../controllers/logCallController.js";
import { getCallLogsController } from "../controllers/getCallLogsController.js";
const router = express.Router();

router.post("/create-room", authMiddleware, createRoomController);
router.post(
  "/room/:roomId/add-participant",
  authMiddleware,
  addParticipantController
);
router.post("/send-message", authMiddleware, sendMessageController);
router.get("/room/:roomId/messages", authMiddleware, getMessagesController);

router.post("/log-call", logCallController);
router.get("/get-call-logs", getCallLogsController);

export default router;
