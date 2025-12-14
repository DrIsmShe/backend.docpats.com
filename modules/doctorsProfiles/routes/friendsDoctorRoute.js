import express from "express";
import {
  getDoctorsList,
  addFriend,
  removeFriend,
  getMyFriends,
} from "../controllers/doctorFriendsController.js";
import authMiddleware from "../../../common/middlewares/authMiddleware.js"; // твой middleware для проверки токена

const router = express.Router();

router.get("/doctors", authMiddleware, getDoctorsList);
router.post("/friends/add", authMiddleware, addFriend);
router.delete("/friends/remove/:friendId", authMiddleware, removeFriend);
router.get("/friends", authMiddleware, getMyFriends);

export default router;
