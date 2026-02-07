import PETScanTemplateNameofexam from "../../../../common/models/Polyclinic/ExamenationsTemplates/PETScansTemplates/PETScanTemplateNameofexam.js";
import PETScanTemplateReport from "../../../../common/models/Polyclinic/ExamenationsTemplates/PETScansTemplates/PETScanTemplateReport.js";
import PETScanTemplateDiagnosis from "../../../../common/models/Polyclinic/ExamenationsTemplates/PETScansTemplates/PETScanTemplateDiagnosis.js";
import PETScanTemplateRecomandation from "../../../../common/models/Polyclinic/ExamenationsTemplates/PETScansTemplates/PETScanTemplateRecomandation.js";

// Обновление шаблона отчёта
const updateNameofexamTemplatesPETScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await PETScanTemplateNameofexam.findByIdAndUpdate(
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
const updateReportTemplatesPETScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await PETScanTemplateReport.findByIdAndUpdate(
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
const updateDiagnosisTemplatesPETScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await PETScanTemplateDiagnosis.findByIdAndUpdate(
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
const updateRecomandationTemplatesPETScanerController = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const updated = await PETScanTemplateRecomandation.findByIdAndUpdate(
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
  updateNameofexamTemplatesPETScanerController,
  updateReportTemplatesPETScanerController,
  updateDiagnosisTemplatesPETScanerController,
  updateRecomandationTemplatesPETScanerController,
};
