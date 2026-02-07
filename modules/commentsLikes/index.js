import express from "express";
const router = express.Router();
// system COMMENT start

// system COMMENT end
import DocpatsCommentRoute from "./routes/CommentsRoutes/commentRoutes.js";
import LikeRoute from "./routes/CommentsRoutes/likeRoute.js";
// system comment start

// system comment end

router.use("/add-comments", DocpatsCommentRoute);
router.use("/add-likes", LikeRoute);

export default router;
