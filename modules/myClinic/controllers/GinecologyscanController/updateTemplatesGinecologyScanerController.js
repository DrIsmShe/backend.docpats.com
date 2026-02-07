import GinecologyScanerTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/GinecologyTemplates/GinecologyScanTemplateNameofexam.js";
import GinecologyScanerTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/GinecologyTemplates/GinecologyScanTemplateReport.js";
import GinecologyScanerTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/GinecologyTemplates/GinecologyTemplatesDiagnosis.js";
import GinecologyScanerTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/GinecologyTemplates/GinecologyScanTemplateRecomandation.js";

// Обновление шаблона отчёта
const updateNameofexamTemplatesGinecologyScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await GinecologyScanerTemplateNameofexam.findByIdAndUpdate(
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
const updateReportTemplatesGinecologyScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await GinecologyScanerTemplateReport.findByIdAndUpdate(
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
const updateDiagnosisTemplatesGinecologyScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await GinecologyScanerTemplateDiagnosis.findByIdAndUpdate(
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
const updateRecomandationTemplatesGinecologyScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated =
      await GinecologyScanerTemplateRecomandation.findByIdAndUpdate(
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
  updateNameofexamTemplatesGinecologyScanerController,
  updateReportTemplatesGinecologyScanerController,
  updateDiagnosisTemplatesGinecologyScanerController,
  updateRecomandationTemplatesGinecologyScanerController,
};
