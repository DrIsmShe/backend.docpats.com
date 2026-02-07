import express from "express";
const router = express.Router();
//SYSTEM OF MESSENDJER START
import UsersForMessengerRoute from "./routes/UsersForMessengerRoute.js";
router.use("/users-for-messenger", UsersForMessengerRoute);
// SYSTEM OF MESSENDJER END
export default router;
