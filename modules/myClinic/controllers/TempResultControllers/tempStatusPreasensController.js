import TempStatusPreasens from "../../../../common/models/Polyclinic/TempResults/tempStatusPreasens.js";
import { tReq } from "../../../../common/i18n/index.js";

const TempStatusPreasensController = async (req, res) => {
  try {
    const { title, content, tags } = req.body;
    const userId = req.session.userId;
    if (!userId) {
      return res.status(400).json({ message: tReq(req, "myClinic.auth.userNotAuthorized") });
    }
    const existingTemplate = await TempStatusPreasens.findOne({ title });
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
    const newTemplate = new TempStatusPreasens({
      title,
      content,
      tags: tagsArray,
      createdBy: userId,
    });
    await newTemplate.save();
    res.status(201).json({
      message: tReq(req, "myClinic.anamnesisMorbi.templateCreatedSuccessfully"),
      template: newTemplate,
    });
  } catch (error) {
    console.error("Ошибка при создании шаблона анамнеза morbi:", error);
    res
      .status(500)
      .json({ message: tReq(req, "myClinic.template.createError"), error: error.message });
  }
};

export default TempStatusPreasensController;
