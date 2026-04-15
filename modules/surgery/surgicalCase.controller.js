import * as caseService from "./surgicalCase.service.js";
import SurgicalCase from "./surgicalCase.model.js";

// ─── POST /api/surgery/cases ──────────────────────────────────────────────
export async function createCase(req, res) {
  try {
    const surgeonId = req.session.userId;
    const result = await caseService.createCase(surgeonId, req.body);
    res.status(201).json({ success: true, case: result });
  } catch (err) {
    console.error("[surgery] createCase error:", err);
    res.status(400).json({ success: false, error: err.message });
  }
}

// ─── GET /api/surgery/cases ───────────────────────────────────────────────
export async function listCases(req, res) {
  try {
    const surgeonId = req.session.userId;
    const { status, procedure, page, limit } = req.query;
    const result = await caseService.listCases(surgeonId, {
      status,
      procedure,
      page,
      limit,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error("[surgery] listCases error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
}

// ─── GET /api/surgery/cases/:id ───────────────────────────────────────────
export async function getCase(req, res) {
  try {
    const surgeonId = req.session.userId;
    const doc = await caseService.getCaseById(req.params.id, surgeonId);
    if (!doc)
      return res.status(404).json({ success: false, error: "Case not found" });
    res.json({ success: true, case: doc });
  } catch (err) {
    console.error("[surgery] getCase error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
}

// ─── PUT /api/surgery/cases/:id ───────────────────────────────────────────
export async function updateCase(req, res) {
  try {
    const surgeonId = req.session.userId;
    const result = await caseService.updateCase(
      req.params.id,
      surgeonId,
      req.body,
    );
    if (!result)
      return res.status(404).json({ success: false, error: "Case not found" });
    res.json({ success: true, case: result });
  } catch (err) {
    console.error("[surgery] updateCase error:", err);
    res.status(400).json({ success: false, error: err.message });
  }
}

// ─── DELETE /api/surgery/cases/:id ────────────────────────────────────────
export async function deleteCase(req, res) {
  try {
    const surgeonId = req.session.userId;
    const ok = await caseService.deleteCase(req.params.id, surgeonId);
    if (!ok)
      return res.status(404).json({ success: false, error: "Case not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("[surgery] deleteCase error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
}

// ─── POST /api/surgery/cases/:id/photos ───────────────────────────────────
export async function addPhoto(req, res) {
  try {
    const surgeonId = req.session.userId;
    if (!req.file)
      return res
        .status(400)
        .json({ success: false, error: "No file uploaded" });

    const label = req.body.label || "before";
    const photo = await caseService.addPhoto(
      req.params.id,
      surgeonId,
      req.file,
      label,
    );
    if (!photo)
      return res.status(404).json({ success: false, error: "Case not found" });
    res.status(201).json({ success: true, photo });
  } catch (err) {
    console.error("[surgery] addPhoto error:", err);
    res.status(400).json({ success: false, error: err.message });
  }
}

// ─── DELETE /api/surgery/cases/:id/photos/:photoId ────────────────────────
export async function removePhoto(req, res) {
  try {
    const surgeonId = req.session.userId;
    const ok = await caseService.removePhoto(
      req.params.id,
      surgeonId,
      req.params.photoId,
    );
    if (!ok)
      return res.status(404).json({ success: false, error: "Photo not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("[surgery] removePhoto error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
}

// ─── POST /api/surgery/cases/:id/followup ─────────────────────────────────
export async function addFollowUp(req, res) {
  try {
    const surgeonId = req.session.userId;
    const { date, notes, complications, addedBy } = req.body;
    if (!date)
      return res
        .status(400)
        .json({ success: false, error: "date is required" });

    const fu = await caseService.addFollowUp(req.params.id, surgeonId, {
      date,
      notes,
      complications,
      addedBy,
    });
    if (!fu)
      return res.status(404).json({ success: false, error: "Case not found" });
    res.status(201).json({ success: true, followUp: fu });
  } catch (err) {
    console.error("[surgery] addFollowUp error:", err);
    res.status(400).json({ success: false, error: err.message });
  }
}

// ─── PUT /api/surgery/cases/:id/outcome ───────────────────────────────────
export async function setOutcome(req, res) {
  try {
    const surgeonId = req.session.userId;
    const score = Number(req.body.score);
    if (!score || score < 1 || score > 10) {
      return res
        .status(400)
        .json({ success: false, error: "score must be 1–10" });
    }
    const result = await caseService.setOutcomeScore(
      req.params.id,
      surgeonId,
      score,
    );
    if (!result)
      return res.status(404).json({ success: false, error: "Case not found" });
    res.json({ success: true, case: result });
  } catch (err) {
    console.error("[surgery] setOutcome error:", err);
    res.status(400).json({ success: false, error: err.message });
  }
}

// ─── PUT /api/surgery/cases/:id/publish ───────────────────────────────────
export async function togglePublish(req, res) {
  try {
    const surgeonId = req.session.userId;
    const publish = req.body.publish !== false; // default true
    const result = await caseService.togglePublic(
      req.params.id,
      surgeonId,
      publish,
    );
    if (!result)
      return res.status(404).json({ success: false, error: "Case not found" });
    res.json({ success: true, case: result });
  } catch (err) {
    console.error("[surgery] togglePublish error:", err);
    res.status(400).json({ success: false, error: err.message });
  }
}

// ─── GET /api/surgery/stats ───────────────────────────────────────────────
export async function getStats(req, res) {
  try {
    const surgeonId = req.session.userId;
    const stats = await caseService.getSurgeonStats(surgeonId);
    res.json({ success: true, stats });
  } catch (err) {
    console.error("[surgery] getStats error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
}

// ─── GET /api/surgery/public ─── публичный маркетплейс (без auth) ─────────
export async function getPublicCases(req, res) {
  try {
    const { procedure, page, limit } = req.query;
    const result = await caseService.getPublicCases({ procedure, page, limit });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error("[surgery] getPublicCases error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
}

// GET /api/surgery/cases/:id/pdf
export async function downloadPDF(req, res) {
  try {
    const surgeonId = req.session.userId;
    const { id } = req.params;

    const cas = await SurgicalCase.findOne({ _id: id, surgeonId });
    if (!cas)
      return res.status(404).json({ success: false, error: "Кейс не найден" });

    const { generateSurgeryPlanPDF } = await import("./pdf.service.js");

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="surgery-plan-${id}.pdf"`,
    );

    generateSurgeryPlanPDF(cas, res);
  } catch (err) {
    console.error("[surgery] downloadPDF error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
}

// GET /api/surgery/cases/by-patient?type=registered&id=xxx
export async function getCasesByPatient(req, res) {
  try {
    const surgeonId = req.session.userId;
    const { type, id } = req.query;

    if (!type || !id) {
      return res
        .status(400)
        .json({ success: false, error: "type и id обязательны" });
    }

    const cases = await caseService.getCasesByPatient(surgeonId, type, id);
    res.json({ success: true, cases });
  } catch (err) {
    console.error("[surgery] getCasesByPatient error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
}
