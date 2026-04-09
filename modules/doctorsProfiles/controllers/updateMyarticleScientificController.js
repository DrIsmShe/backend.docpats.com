import { uploadFile } from "../../../common/middlewares/uploadMiddleware.js";
import ArticleScientific from "../../../common/models/Articles/articles-scince.js";

const updateMyArticleController = async (req, res) => {
  try {
    const { id } = req.params;

    const existed = await ArticleScientific.findById(id);
    if (!existed)
      return res.status(404).json({ message: "ArticleScientific not found" });

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

    const updated = await ArticleScientific.findByIdAndUpdate(
      id,
      updateFields,
      {
        new: true,
        runValidators: true,
      },
    );

    return res.status(200).json({
      message: "ArticleScientific updated successfully",
      article: updated,
    });
  } catch (error) {
    console.error("❌ Error updating article:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

export default updateMyArticleController;
