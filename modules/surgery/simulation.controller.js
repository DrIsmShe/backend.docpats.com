import * as service from "./simulation.service.js";
import { maxPaintedPct, isFaceProcedure } from "./procedureZones.js";
import { simulationQuotaLeft } from "./simulationQuota.service.js";
import { tReq } from "../../common/i18n/index.js";
import { errorText } from "../../common/i18n/index.js";

// POST /api/surgery/cases/:id/simulate
export async function startSimulation(req, res) {
  try {
    const surgeonId = req.session.userId;
    const caseId = req.params.id;
    const {
      sourcePhotoFilename,
      customPrompt,
      promptIdx,
      promptProcedure,
      disclaimerAccepted,
    } = req.body;

    if (!sourcePhotoFilename) {
      return res
        .status(400)
        .json({ success: false, error: tReq(req, "app.validation.sourcePhotoFilenameRequired") });
    }

    const maskFilename = req.file?.filename || null;

    const simulation = await service.createSimulation(caseId, surgeonId, {
      sourcePhotoFilename,
      maskFilename,
      customPrompt,
      promptIdx: Number(promptIdx) || 0,
      promptProcedure,
      disclaimerAccepted:
        disclaimerAccepted === true || disclaimerAccepted === "true",
    });

    res.status(201).json({ success: true, simulation });
  } catch (err) {
    console.error("[simulation] startSimulation error:", err);
    res.status(400).json({ success: false, error: errorText(err, req) });
  }
}

// GET /api/surgery/cases/:id/simulations
export async function getSimulations(req, res) {
  try {
    const surgeonId = req.session.userId;
    const caseId = req.params.id;
    const simulations = await service.getSimulations(caseId, surgeonId);
    res.json({ success: true, simulations });
  } catch (err) {
    console.error("[simulation] getSimulations error:", err);
    res.status(500).json({ success: false, error: errorText(err, req) });
  }
}

// GET /api/surgery/prompts/:procedure
export async function getPrompts(req, res) {
  try {
    const { procedure } = req.params;
    // Порог площади отдаём вместе со списком: клиент должен показать
    // «отмечено N% кадра» и предупредить ДО генерации, а не дублировать у
    // себя перечень лицевых операций, который разъедется с серверным.
    res.json({
      success: true,
      prompts: service.getPromptsForProcedure(procedure),
      maxPaintedPct: maxPaintedPct(procedure),
      isFaceProcedure: isFaceProcedure(procedure),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: errorText(err, req) });
  }
}

// GET /api/surgery/prompts — весь каталог зон правки
//
// Отдельно от /prompts/:procedure: клиенту нужен весь список сразу, чтобы
// врач мог выбрать зону, не совпадающую с типом операции в кейсе.
// GET /api/surgery/simulations/quota — остаток симуляций по тарифу
export async function getQuota(req, res) {
  try {
    const quota = await simulationQuotaLeft(req.session.userId);
    res.json({ success: true, quota });
  } catch (err) {
    console.error("[simulation] getQuota error:", err);
    res.status(500).json({ success: false, error: errorText(err, req) });
  }
}

export async function getPromptCatalog(req, res) {
  try {
    res.json({ success: true, catalog: service.getPromptCatalog() });
  } catch (err) {
    console.error("[simulation] getPromptCatalog error:", err);
    res.status(500).json({ success: false, error: errorText(err, req) });
  }
}

// PUT /api/surgery/simulations/:simId/select
export async function selectResult(req, res) {
  try {
    const surgeonId = req.session.userId;
    const { simId } = req.params;
    const { idx } = req.body;

    if (idx === undefined || idx === null) {
      return res.status(400).json({ success: false, error: tReq(req, "app.validation.idxRequired") });
    }

    const sim = await service.selectResult(simId, surgeonId, Number(idx));
    res.json({ success: true, simulation: sim });
  } catch (err) {
    console.error("[simulation] selectResult error:", err);
    res.status(400).json({ success: false, error: errorText(err, req) });
  }
}

// DELETE /api/surgery/simulations/:simId
export async function deleteSimulation(req, res) {
  try {
    const surgeonId = req.session.userId;
    const { simId } = req.params;
    const ok = await service.deleteSimulation(simId, surgeonId);
    if (!ok)
      return res
        .status(404)
        .json({ success: false, error: tReq(req, "app.simulation.notFound") });
    res.json({ success: true });
  } catch (err) {
    console.error("[simulation] deleteSimulation error:", err);
    res.status(500).json({ success: false, error: errorText(err, req) });
  }
}
