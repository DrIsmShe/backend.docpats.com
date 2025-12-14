import Article from "../../../common/models/Articles/articles.js";
import Category from "../../../common/models/Articles/articlesCategories.js";

const createArticleController = async (req, res) => {
  const {
    title,
    content,
    abstract,
    tags,
    isPublished,
    metadesc,
    metakeywords,
    category,
  } = req.body;
  console.log("\ud83d\udccc Request data:", req.body);
  console.log(
    "\ud83d\udccc Uploaded file:",
    req.file ? req.file.filename : "No file"
  );

  // Check if user is in session
  if (!req.session.userId) {
    console.log("\u274c Error: User not authenticated.");
    return res.status(403).json({ message: "Please sign in." });
  }

  console.log("\ud83d\udca1 User ID from session:", req.session.userId);

  // Check if category exists
  const categoryExists = await Category.findById(category);
  if (!categoryExists) {
    console.error("\u274c Error: Category not found!", category);
    return res.status(400).json({ message: "Category does not exist." });
  }

  // Преобразование данных
  const isPublishedBoolean = isPublished === "true";
  const formattedTags = tags ? tags.split(",").map((tag) => tag.trim()) : [];
  const formattedMetaDesc = metadesc
    ? metadesc.split(",").map((desc) => desc.trim())
    : [];
  const formattedMetaKeywords = metakeywords
    ? metakeywords.split(",").map((keyword) => keyword.trim())
    : [];

  console.log("\u2705 Creating a new article with data:", {
    title,
    content,
    abstract,
    tags: formattedTags,
    isPublished: isPublishedBoolean,
    metadesc: formattedMetaDesc,
    metakeywords: formattedMetaKeywords,
    category,
    authorId: req.session.userId,
  });

  try {
    // Создание новой статьи
    const newArticle = new Article({
      title,
      content,
      abstract,
      tags: formattedTags,
      isPublished: isPublishedBoolean,
      metaDescription: formattedMetaDesc,
      metaKeywords: formattedMetaKeywords,
      authorId: req.session.userId,
      category,
      imageUrl: req.file
        ? `http://localhost:11000/uploads/${req.file.filename}`
        : "",
    });

    console.log("\ud83d\udd16 Saving article to database...");
    console.log(
      "➡ imageUrl to save:",
      req.file
        ? `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`
        : null
    );
    console.log(
      "➡ fs.exists:",
      req.file
        ? fs.existsSync(path.join(process.cwd(), "uploads", req.file.filename))
        : null
    );

    const savedArticle = await newArticle.save();
    console.log("\u2705 Article saved successfully:", savedArticle);
    return res.status(201).json({
      message: "Article created successfully.",
      article: savedArticle,
    });
  } catch (error) {
    console.error("\u274c Error saving article:", error);
    return res.status(500).json({
      message: "An error occurred while creating the article.",
      error: error.message,
    });
  }
};

export default createArticleController;
