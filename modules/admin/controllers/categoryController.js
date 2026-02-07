import Category from "../../../common/models/Articles/articlesCategories.js";

// Функция для генерации slug
const generateSlug = (name) => {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
};

// Создание категории
export const createCategory = async (req, res) => {
  try {
    const {
      name,
      description,
      slug,
      parentCategory,
      icon,
      metaDescription,
      metaKeywords,
    } = req.body;

    // Проверка на обязательные поля
    if (!name || !description) {
      return res
        .status(400)
        .json({ message: "Category name and description are required.." });
    }

    // Генерация slug, если он не указан
    const generatedSlug = slug || generateSlug(name);

    // Проверка на дубликат slug
    const existingCategory = await Category.findOne({ slug: generatedSlug });
    if (existingCategory) {
      return res
        .status(400)
        .json({ message: "A category with this slug already exists." });
    }

    // Обработка parentCategory
    const parentCategoryId = parentCategory || null;

    // Создаем новую категорию
    const newCategory = new Category({
      name,
      description,
      slug: generatedSlug,
      parentCategory: parentCategoryId,
      icon,
      metaDescription,
      metaKeywords,
    });

    // Сохраняем категорию в базе
    await newCategory.save();

    res.status(201).json({
      message: "Category successfully created",
      category: newCategory,
    });
  } catch (error) {
    console.error("Error creating category:", error);
    res
      .status(500)
      .json({ message: "Error creating category", error: error.message });
  }
};

// Получение всех категорий
export const getAllCategories = async (req, res) => {
  try {
    const categories = await Category.find().populate("parentCategory", "name");
    res.status(200).json(categories);
  } catch (error) {
    res.status(500).json({
      message: "Error getting categories",
      error: error.message,
    });
  }
};

// Получение категории по ID
export const getCategoryById = async (req, res) => {
  try {
    const { id } = req.params;

    const category = await Category.findById(id).populate(
      "parentCategory",
      "name"
    );

    if (!category)
      return res.status(404).json({ message: "Category not found" });

    res.status(200).json(category);
  } catch (error) {
    res.status(500).json({
      message: "Error getting category",
      error: error.message,
    });
  }
};

// Обновление категории
export const updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      description,
      slug,
      parentCategory,
      icon,
      metaDescription,
      metaKeywords,
    } = req.body;

    // Генерация slug, если он не указан
    const updatedSlug = slug || (name ? generateSlug(name) : undefined);

    // Проверка на дубликат slug
    if (updatedSlug) {
      const existingCategory = await Category.findOne({ slug: updatedSlug });
      if (existingCategory && existingCategory._id.toString() !== id) {
        return res
          .status(400)
          .json({ message: "A category with this slug already exists." });
      }
    }

    const updatedCategory = await Category.findByIdAndUpdate(
      id,
      {
        name,
        description,
        slug: updatedSlug,
        parentCategory: parentCategory || null,
        icon,
        metaDescription,
        metaKeywords,
      },
      { new: true } // возвращаем обновленный объект
    );

    if (!updatedCategory)
      return res.status(404).json({ message: "Category not found" });

    res.status(200).json({
      message: "Category successfully updated",
      category: updatedCategory,
    });
  } catch (error) {
    res.status(500).json({
      message: "Error updating category",
      error: error.message,
    });
  }
};

// Удаление категории
export const deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;

    const deletedCategory = await Category.findByIdAndDelete(id);

    if (!deletedCategory)
      return res.status(404).json({ message: "Category not found" });

    res.status(200).json({ message: "Category successfully deleted" });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error deleting category", error: error.message });
  }
};
