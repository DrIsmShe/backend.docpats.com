// modules/admin/controllers/adminOverview.controller.js
//
// Сводный дашборд платформы для админа + просмотр HIPAA аудит-лога.
// Всё под requireAdmin (см. adminOverviewRoute.js).

import mongoose from "mongoose";
import { HIPAAAuditLog } from "../../audit/index.js";
import { auditAdminAccess } from "../adminAudit.js";

// Безопасный счётчик: несуществующая коллекция → 0, не падаем.
async function count(collection, filter = {}) {
  try {
    return await mongoose.connection.db.collection(collection).countDocuments(filter);
  } catch {
    return 0;
  }
}

// ─── GET /admin/overview ───────────────────────────────────────
// Счётчики по всем ключевым модулям платформы.
export async function getOverview(req, res) {
  try {
    const [
      usersTotal, doctors, patients, admins,
      clinics, clinicsActive,
      memberships, clinicPatients, appointments, consilia, telemed,
      doctorProfiles, patientProfiles, polyclinicPatients,
      articles, reviews, consultations,
      notifications, simulations, leads, auditLogs,
    ] = await Promise.all([
      count("users"),
      count("users", { role: "doctor" }),
      count("users", { role: "patient" }),
      count("users", { role: "admin" }),
      count("clinics"),
      count("clinics", { isActive: { $ne: false } }),
      count("clinic_memberships", { leftAt: null }),
      count("clinic_patients"),
      count("clinic_appointments"),
      count("clinic_consilia"),
      count("clinic_telemed_sessions"),
      count("doctorprofiles"),
      count("patientprofiles"),
      count("newpatientpolyclinics"),
      count("articles"),
      count("clinic_reviews"),
      count("consultations"),
      count("notifications"),
      count("simulation_plans"),
      count("clinic_leads"),
      count("hipaa_audit_logs"),
    ]);

    res.json({
      users: { total: usersTotal, doctors, patients, admins },
      clinics: {
        total: clinics,
        active: clinicsActive,
        blocked: clinics - clinicsActive,
        memberships,
        patients: clinicPatients,
        appointments,
        consilia,
        telemed,
      },
      profiles: { doctorProfiles, patientProfiles, polyclinicPatients },
      content: { articles, reviews, consultations },
      other: { notifications, simulations, leads, auditLogs },
    });
  } catch (err) {
    console.error("adminOverview.getOverview:", err);
    res.status(500).json({ message: "Server error" });
  }
}

// ─── GET /admin/audit-log ──────────────────────────────────────
// Просмотр HIPAA аудит-лога. Фильтры: action, resourceType, outcome, userId.
// Пагинация: limit (по умолч. 50, макс 200), skip.
export async function getAuditLog(req, res) {
  try {
    const { action, resourceType, outcome, userId, limit = 50, skip = 0 } = req.query;
    const filter = {};
    if (action) filter.action = action;
    if (resourceType) filter.resourceType = resourceType;
    if (outcome) filter.outcome = outcome;
    if (userId && mongoose.isValidObjectId(userId)) filter.userId = userId;

    const lim = Math.min(Number(limit) || 50, 200);
    const sk = Math.max(Number(skip) || 0, 0);

    const [rows, total] = await Promise.all([
      HIPAAAuditLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(sk)
        .limit(lim)
        .lean(),
      HIPAAAuditLog.countDocuments(filter),
    ]);

    // Сам просмотр аудита — тоже аудируемое действие.
    auditAdminAccess(req, {
      action: "list",
      resourceType: "other",
      metadata: { view: "audit-log", count: rows.length },
    });

    res.json({
      logs: rows.map((r) => ({
        _id: String(r._id),
        action: r.action,
        resourceType: r.resourceType,
        resourceId: r.resourceId ? String(r.resourceId) : null,
        userId: r.userId ? String(r.userId) : null,
        actorRole: r.actorRole || null,
        outcome: r.outcome,
        failureReason: r.failureReason || null,
        ipAddress: r.context?.ipAddress || null,
        createdAt: r.createdAt,
        // metadata по правилам проекта не содержит PHI — отдаём как есть
        metadata: r.metadata || null,
      })),
      total,
      limit: lim,
      skip: sk,
    });
  } catch (err) {
    console.error("adminOverview.getAuditLog:", err);
    res.status(500).json({ message: "Server error" });
  }
}
