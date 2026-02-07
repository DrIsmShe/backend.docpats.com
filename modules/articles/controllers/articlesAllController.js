import Article from "../../../common/models/Articles/articles.js"; // Model for article

const articlesAllController = async (req, res) => {
  try {
    // Get all articles from the database
    const articles = await Article.find(); // You can add sorting or filtering if needed

    if (!articles) {
      return res.status(404).json({ message: "No articles found" });
    }

    return res.status(200).json({ articles });
  } catch (err) {
    console.error("Error getting articles:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

export default articlesAllController;
