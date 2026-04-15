import * as service from "./simulation.service.js";

// POST /api/surgery/cases/:id/simulate
export async function startSimulation(req, res) {
  try {
    const surgeonId = req.session.userId;
    const caseId = req.params.id;
    const { sourcePhotoFilename, customPrompt, promptIdx, disclaimerAccepted } =
      req.body;

    if (!sourcePhotoFilename) {
      return res
        .status(400)
        .json({ success: false, error: "sourcePhotoFilename обязателен" });
    }

    const maskFilename = req.file?.filename || null;

    const simulation = await service.createSimulation(caseId, surgeonId, {
      sourcePhotoFilename,
      maskFilename,
      customPrompt,
      promptIdx: Number(promptIdx) || 0,
      disclaimerAccepted:
        disclaimerAccepted === true || disclaimerAccepted === "true",
    });

    res.status(201).json({ success: true, simulation });
  } catch (err) {
    console.error("[simulation] startSimulation error:", err);
    res.status(400).json({ success: false, error: err.message });
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
    res.status(500).json({ success: false, error: err.message });
  }
}

// GET /api/surgery/prompts/:procedure
export async function getPrompts(req, res) {
  try {
    const { procedure } = req.params;
    const prompts = service.getPromptsForProcedure(procedure);
    res.json({ success: true, prompts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// PUT /api/surgery/simulations/:simId/select
export async function selectResult(req, res) {
  try {
    const surgeonId = req.session.userId;
    const { simId } = req.params;
    const { idx } = req.body;

    if (idx === undefined || idx === null) {
      return res.status(400).json({ success: false, error: "idx обязателен" });
    }

    const sim = await service.selectResult(simId, surgeonId, Number(idx));
    res.json({ success: true, simulation: sim });
  } catch (err) {
    console.error("[simulation] selectResult error:", err);
    res.status(400).json({ success: false, error: err.message });
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
        .json({ success: false, error: "Симуляция не найдена" });
    res.json({ success: true });
  } catch (err) {
    console.error("[simulation] deleteSimulation error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
}
