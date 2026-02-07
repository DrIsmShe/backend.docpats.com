import TempMRIResult from "../../../../common/models/Polyclinic/TempResults/tempMRIResults.js";

const TempMRIResultController = async (req, res) => {
  try {
    const { title, content, tags } = req.body;
    const userId = req.session.userId;

    if (!userId) {
      return res.status(400).json({ message: "Пользователь не авторизован." });
    }

    console.log("Полученные данные:", { title, content, tags });

    const existingTemplate = await TempMRIResult.findOne({ title });
    if (existingTemplate) {
      return res
        .status(400)
        .json({ message: "Шаблон с таким названием уже существует." });
    }

    let tagsArray = [];
    if (tags) {
      tagsArray = Array.isArray(tags)
        ? tags
        : tags.split(",").map((tag) => tag.trim());
    }

    const newTemplate = new TempMRIResult({
      title,
      content,
      tags: tagsArray,
      createdBy: userId,
    });

    console.log("Данные перед сохранением:", newTemplate);

    await newTemplate.save();

    console.log("Шаблон успешно сохранен!");

    res.status(201).json({
      message: "Шаблон результатов МРТ создан успешно",
      template: newTemplate,
    });
  } catch (error) {
    console.error("Ошибка при создании шаблона результатов МРТ:", error);
    res
      .status(500)
      .json({ message: "Ошибка при создании шаблона", error: error.message });
  }
};

export default TempMRIResultController;
