import TempAdditionalDiagnosis from "../../../../common/models/Polyclinic/TempResults/tempAdditionalDiagnosis.js";
import { tReq } from "../../../../common/i18n/index.js";
import { errorText } from "../../../../common/i18n/index.js";

const tempAdditionalDiagnosisController = async (req, res) => {
  try {
    const { title, content, tags } = req.body;
    const userId = req.session.userId;
    if (!userId) {
      return res.status(400).json({ message: tReq(req, "myClinic.auth.userNotAuthorized") });
    }
    const existingTemplate = await TempAdditionalDiagnosis.findOne({ title });
    if (existingTemplate) {
      return res
        .status(400)
        .json({ message: tReq(req, "myClinic.template.nameAlreadyExists") });
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
      message: tReq(req, "myClinic.template.createdSuccessfully"),
      template: newTemplate,
    });
  } catch (error) {
    console.error("Ошибка при создании шаблона:", error);
    res
      .status(500)
      .json({ message: tReq(req, "myClinic.template.createError"), error: errorText(error, req) });
  }
};

export default tempAdditionalDiagnosisController;
