import { uploadFile } from "../../../common/middlewares/uploadMiddleware.js";
import Article from "../../../common/models/Articles/articles.js";

const updateMyArticleController = async (req, res) => {
  try {
    const { id } = req.params;

    const existed = await Article.findById(id);
    if (!existed) return res.status(404).json({ message: "Article not found" });

    // 🔒 БЕЗОПАСНОСТЬ: править может ТОЛЬКО автор статьи или админ.
    const isAdmin = req.user?.role === "admin";
    const isOwner =
      existed.authorId && String(existed.authorId) === String(req.userId);
    if (!isAdmin && !isOwner) {
      return res
        .status(403)
        .json({ message: "Forbidden: you are not the author of this article." });
    }

    const updateFields = {
      title: req.body.title,
      content: req.body.content,
      tags: req.body.tags,
      metaDescription: req.body.metaDescription,
      metaKeywords: req.body.metaKeywords,
      isPublished: req.body.isPublished,
      category: req.body.category,
      updatedAt: Date.now(),
    };

    // 🔥 ВСЁ! Только uploadFile даёт правильный URL
    if (req.file) {
      const fileUrl = await uploadFile(req.file); // <-- ВОТ ЭТО ВАЖНО
      updateFields.imageUrl = fileUrl;
    }

    const updated = await Article.findByIdAndUpdate(id, updateFields, {
      new: true,
      runValidators: true,
    });

    return res.status(200).json({
      message: "Article updated successfully",
      article: updated,
    });
  } catch (error) {
    console.error("❌ Error updating article:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

export default updateMyArticleController;
