import TempAnamnesisMorbi from "../../../../common/models/Polyclinic/TempResults/tempAnamnesisMorbi.js";

const tempAnamnesisMorbiController = async (req, res) => {
  try {
    const { title, content, tags } = req.body;
    const userId = req.session.userId;
    if (!userId) {
      return res.status(400).json({ message: req.t("myClinic.auth.userNotAuthorized") });
    }
    const existingTemplate = await TempAnamnesisMorbi.findOne({ title });
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
    const newTemplate = new TempAnamnesisMorbi({
      title,
      content,
      tags: tagsArray,
      createdBy: userId,
    });
    console.log("Создается шаблон анамнеза morbi:", newTemplate); // <-- Проверка перед сохранением
    await newTemplate.save();
    res.status(201).json({
      message: req.t("myClinic.anamnesisMorbi.templateCreatedSuccessfully"),
      template: newTemplate,
    });
  } catch (error) {
    console.error("Ошибка при создании шаблона анамнеза morbi:", error);
    res
      .status(500)
      .json({ message: req.t("myClinic.template.createError"), error: error.message });
  }
};

export default tempAnamnesisMorbiController;
