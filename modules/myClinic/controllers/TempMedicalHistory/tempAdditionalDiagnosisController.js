import TempAdditionalDiagnosis from "../../../../common/models/Polyclinic/TempResults/tempAdditionalDiagnosis.js";

const tempAdditionalDiagnosisController = async (req, res) => {
  try {
    const { title, content, tags } = req.body;
    const userId = req.session.userId;
    if (!userId) {
      return res.status(400).json({ message: req.t("myClinic.auth.userNotAuthorized") });
    }
    const existingTemplate = await TempAdditionalDiagnosis.findOne({ title });
    if (existingTemplate) {
      return res
        .status(400)
        .json({ message: req.t("myClinic.template.nameAlreadyExists") });
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
      message: req.t("myClinic.template.createdSuccessfully"),
      template: newTemplate,
    });
  } catch (error) {
    console.error("Ошибка при создании шаблона:", error);
    res
      .status(500)
      .json({ message: req.t("myClinic.template.createError"), error: error.message });
  }
};

export default tempAdditionalDiagnosisController;
