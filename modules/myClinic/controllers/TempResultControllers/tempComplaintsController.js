import TempComplaints from "../../../../common/models/Polyclinic/TempResults/tempComplaints.js";

const tempComplaintsController = async (req, res) => {
  try {
    const { title, content, tags } = req.body;

    // Получите userId из сессии
    const userId = req.session.userId; // Это должно быть записано в сессии
    if (!userId) {
      return res.status(400).json({ message: "Пользователь не авторизован." });
    }

    // Проверка на существование шаблона с таким же названием
    const existingComplaint = await TempComplaints.findOne({ title });
    if (existingComplaint) {
      return res
        .status(400)
        .json({ message: "Шаблон с таким названием уже существует." });
    }

    // Обработка тегов
    let tagsArray = [];
    if (tags) {
      tagsArray = Array.isArray(tags)
        ? tags
        : tags.split(",").map((tag) => tag.trim());
    }

    // Создание нового шаблона жалобы
    const newComplaint = new TempComplaints({
      title,
      content,
      tags: tagsArray,
      createdBy: userId, // Использование userId из сессии
    });

    await newComplaint.save();
    res.status(201).json({
      message: "Шаблон жалобы создан успешно",
      complaint: newComplaint,
    });
  } catch (error) {
    console.error("Ошибка при создании шаблона:", error);
    res
      .status(500)
      .json({ message: "Ошибка при создании шаблона", error: error.message });
  }
};

export default tempComplaintsController;
