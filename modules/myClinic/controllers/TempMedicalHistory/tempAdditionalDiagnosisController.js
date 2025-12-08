import TempAdditionalDiagnosis from "../../../../common/models/Polyclinic/TempResults/tempAdditionalDiagnosis.js";

const tempAdditionalDiagnosisController = async (req, res) => {
  try {
    const { title, content, tags } = req.body;
    const userId = req.session.userId;
    if (!userId) {
      return res.status(400).json({ message: "Пользователь не авторизован." });
    }
    const existingTemplate = await TempAdditionalDiagnosis.findOne({ title });
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
    const newTemplate = new TempAdditionalDiagnosis({
      title,
      content,
      tags: tagsArray,
      createdBy: userId,
    });
    console.log("Создается шаблон :", newTemplate); // <-- Проверка перед сохранением
    await newTemplate.save();
    res.status(201).json({
      message: "Шаблон создан успешно",
      template: newTemplate,
    });
  } catch (error) {
    console.error("Ошибка при создании шаблона:", error);
    res
      .status(500)
      .json({ message: "Ошибка при создании шаблона", error: error.message });
  }
};

export default tempAdditionalDiagnosisController;
