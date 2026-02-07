import XRAYScanTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/XRayScansTemplates/XRayScanTemplateNameofexams.js";
import XRAYScanTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/XRayScansTemplates/XRayScanTemplateReports.js";
import XRAYScanTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/XRayScansTemplates/XRayScanTemplateDiagnos.js";
import XRAYScanTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/XRayScansTemplates/XRayScanTemplateRecomandations.js";

// Обновление шаблона отчёта
const updateNameofexamTemplatesXRAYScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await XRAYScanTemplateNameofexam.findByIdAndUpdate(
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
const updateReportTemplatesXRAYScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await XRAYScanTemplateReport.findByIdAndUpdate(
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
const updateDiagnosisTemplatesXRAYScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await XRAYScanTemplateDiagnosis.findByIdAndUpdate(
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
const updateRecomandationTemplatesXRAYScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await XRAYScanTemplateRecomandation.findByIdAndUpdate(
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
  updateNameofexamTemplatesXRAYScanerController,
  updateReportTemplatesXRAYScanerController,
  updateDiagnosisTemplatesXRAYScanerController,
  updateRecomandationTemplatesXRAYScanerController,
};
