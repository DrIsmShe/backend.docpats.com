import EEGScanTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/EEGScansTemplates/EEGScanTemplateNameofexam.js";
import EEGScanTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/EEGScansTemplates/EEGScanTemplateReport.js";
import EEGScanTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/EEGScansTemplates/EEGScanTemplateDiagnosis.js";
import EEGScanTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/EEGScansTemplates/EEGScanTemplateRecomandation.js";

// Обновление шаблона отчёта
const updateNameofexamTemplatesEEGScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await EEGScanTemplateNameofexam.findByIdAndUpdate(
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
const updateReportTemplatesEEGScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await EEGScanTemplateReport.findByIdAndUpdate(
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
const updateDiagnosisTemplatesEEGScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await EEGScanTemplateDiagnosis.findByIdAndUpdate(
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
const updateRecomandationTemplatesEEGScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await EEGScanTemplateRecomandation.findByIdAndUpdate(
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
  updateNameofexamTemplatesEEGScanerController,
  updateReportTemplatesEEGScanerController,
  updateDiagnosisTemplatesEEGScanerController,
  updateRecomandationTemplatesEEGScanerController,
};
