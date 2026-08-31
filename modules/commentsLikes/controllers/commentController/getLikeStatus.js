import Article from "../../../../common/models/articles.js";
import User from "../../../../common/models/user.js";
import { tReq } from "../../../../common/i18n/index.js";
export const getLikeStatus = async (req, res) => {
  try {
    const { targetType, targetId } = req.params;
    const userId = req.user._id;

    let doc,
      likes = [];
    if (targetType === "article") {
      doc = await Article.findById(targetId);
    } else if (targetType === "doctor") {
      doc = await User.findById(targetId);
    }

    if (!doc) return res.status(404).json({ message: tReq(req, "app.general.notFound") });

    likes = doc.likes || [];
    const liked = likes.includes(userId);
    return res.json({ likesCount: likes.length, liked });
  } catch (err) {
    res.status(500).json({ message: tReq(req, "app.like.statusError") });
  }
};
