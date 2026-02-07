import AngiographyScanerTemplateNameofexam from "../../../../common/models/ExamenationsTemplates/AngiographyscanTemplates/AngiographyScanTemplateNameofexam.js";
import AngiographyScanerTemplateReport from "../../../../common/models/ExamenationsTemplates/AngiographyscanTemplates/AngiographyScanTemplateReport.js";
import AngiographycanerTemplateDiagnosis from "../../../../common/models/ExamenationsTemplates/AngiographyscanTemplates/AngiographyScanTemplateDiagnosis.js";
import AngiographyScanerTemplateRecomandation from "../../../../common/models/ExamenationsTemplates/AngiographyscanTemplates/AngiographyScanTemplateRecomandation.js";

// Обновление шаблона отчёта
const updateNameofexamTemplatesAngiographyScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await AngiographyScanerTemplateNameofexam.findByIdAndUpdate(
      id,
      { title, content },
      { new: true, runValidators: true }
    );

    if (!updated) {
      return res.status(404).json({ message: "Шаблон отчёта не найден" });
    }

    res
      .status(200)
      .json({ message: "✅ Шаблон отчёта успешно обновлён", updated });
  } catch (error) {
    res.status(500).json({
      message: "❌ Ошибка при обновлении шаблона отчёта",
      error: error.message,
    });
  }
};

// Обновление шаблона отчёта
const updateReportTemplatesAngiographyScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await AngiographyScanerTemplateReport.findByIdAndUpdate(
      id,
      { title, content },
      { new: true, runValidators: true }
    );

    if (!updated) {
      return res.status(404).json({ message: "Шаблон отчёта не найден" });
    }

    res
      .status(200)
      .json({ message: "✅ Шаблон отчёта успешно обновлён", updated });
  } catch (error) {
    res.status(500).json({
      message: "❌ Ошибка при обновлении шаблона отчёта",
      error: error.message,
    });
  }
};

// Обновление шаблона диагноза
const updateDiagnosisTemplatesAngiographyScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await AngiographycanerTemplateDiagnosis.findByIdAndUpdate(
      id,
      { title, content },
      { new: true, runValidators: true }
    );

    if (!updated) {
      return res.status(404).json({ message: "Шаблон диагноза не найден" });
    }

    res
      .status(200)
      .json({ message: "✅ Шаблон диагноза успешно обновлён", updated });
  } catch (error) {
    res.status(500).json({
      message: "❌ Ошибка при обновлении шаблона диагноза",
      error: error.message,
    });
  }
};

// Обновление шаблона рекомендации
const updateRecomandationTemplatesAngiographyScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated =
      await AngiographyScanerTemplateRecomandation.findByIdAndUpdate(
        id,
        { title, content },
        { new: true, runValidators: true }
      );

    if (!updated) {
      return res.status(404).json({ message: "Шаблон рекомендации не найден" });
    }

    res
      .status(200)
      .json({ message: "✅ Шаблон рекомендации успешно обновлён", updated });
  } catch (error) {
    res.status(500).json({
      message: "❌ Ошибка при обновлении шаблона рекомендации",
      error: error.message,
    });
  }
};

export default {
  updateNameofexamTemplatesAngiographyScanerController,
  updateReportTemplatesAngiographyScanerController,
  updateDiagnosisTemplatesAngiographyScanerController,
  updateRecomandationTemplatesAngiographyScanerController,
};
