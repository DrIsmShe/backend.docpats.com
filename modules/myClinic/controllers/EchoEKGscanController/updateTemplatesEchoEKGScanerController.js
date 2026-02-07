import EchoEKGScanerTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/EchoEKGscanTemplates/EchoEKGScanTemplateNameofexam.js";
import EchoEKGScanerTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/EchoEKGscanTemplates/EchoEKGScanTemplateReport.js";
import EchoEKGScanerTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/EchoEKGscanTemplates/EchoEKGScanTemplateDiagnosis.js";
import EchoEKGScanerTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/EchoEKGscanTemplates/EchoEKGScanTemplateRecomandation.js";

// Обновление шаблона отчёта
const updateNameofexamTemplatesEchoEKGScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await EchoEKGScanerTemplateNameofexam.findByIdAndUpdate(
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
const updateReportTemplatesEchoEKGScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await EchoEKGScanerTemplateReport.findByIdAndUpdate(
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
const updateDiagnosisTemplatesEchoEKGScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await EchoEKGScanerTemplateDiagnosis.findByIdAndUpdate(
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
const updateRecomandationTemplatesEchoEKGScanerController = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await EchoEKGScanerTemplateRecomandation.findByIdAndUpdate(
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
  updateNameofexamTemplatesEchoEKGScanerController,
  updateReportTemplatesEchoEKGScanerController,
  updateDiagnosisTemplatesEchoEKGScanerController,
  updateRecomandationTemplatesEchoEKGScanerController,
};
