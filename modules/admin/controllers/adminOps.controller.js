// modules/admin/controllers/adminOps.controller.js
//
// п.2 Дашборд безопасности (на базе HIPAA-аудита) + п.5 Статус системы.
// Всё под requireAdmin.

import mongoose from "mongoose";
import { HIPAAAuditLog } from "../../audit/index.js";
import { auditAdminAccess } from "../adminAudit.js";

// ─── GET /admin/security-dashboard ─────────────────────────────
// Признаки атак/инсайдеров за N дней (по умолч. 7): отказы доступа, неудачные
// входы, блокировки, топ-акторы по denied.
export async function securityDashboard(req, res) {
  try {
    const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 90);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const match = { createdAt: { $gte: since } };

    const [
      deniedTotal,
      failedLogins,
      accountsLocked,
      failuresTotal,
      topDenied,
      recentDenied,
    ] = await Promise.all([
      HIPAAAuditLog.countDocuments({ ...match, outcome: "denied" }),
      HIPAAAuditLog.countDocuments({ ...match, action: "auth.failed_login" }),
      HIPAAAuditLog.countDocuments({ ...match, action: "auth.account_locked" }),
      HIPAAAuditLog.countDocuments({ ...match, outcome: "failure" }),
      HIPAAAuditLog.aggregate([
        { $match: { ...match, outcome: "denied" } },
        { $group: { _id: "$userId", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
      HIPAAAuditLog.find({ ...match, outcome: "denied" })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
    ]);

    auditAdminAccess(req, {
      action: "list",
      resourceType: "other",
      metadata: { view: "security-dashboard", days },
    });

    res.json({
      periodDays: days,
      counters: {
        deniedTotal,
        failedLogins,
        accountsLocked,
        failuresTotal,
      },
      topDeniedActors: topDenied.map((t) => ({
        userId: t._id ? String(t._id) : "anon",
        count: t.count,
      })),
      recentDenied: recentDenied.map((r) => ({
        _id: String(r._id),
        action: r.action,
        resourceType: r.resourceType,
        userId: r.userId ? String(r.userId) : null,
        failureReason: r.failureReason || null,
        ipAddress: r.context?.ipAddress || null,
        createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    console.error("adminOps.securityDashboard:", err);
    res.status(500).json({ message: "Server error" });
  }
}

// ─── GET /admin/system-health ──────────────────────────────────
// Состояние инфраструктуры: MongoDB, Redis, размеры ключевых коллекций.
export async function systemHealth(req, res) {
  const states = ["disconnected", "connected", "connecting", "disconnecting"];
  const health = { mongo: null, redis: null, collections: {} };

  // MongoDB
  health.mongo = {
    state: states[mongoose.connection.readyState] || "unknown",
    ok: mongoose.connection.readyState === 1,
  };

  // Redis (best-effort ping)
  try {
    const { default: redis } = await import("../../../common/config/redis.js");
    if (redis && typeof redis.ping === "function") {
      const pong = await redis.ping();
      health.redis = { ok: pong === "PONG", reply: pong };
    } else {
      health.redis = { ok: false, reply: "no client" };
    }
  } catch (e) {
    health.redis = { ok: false, reply: e.message };
  }

  // Размеры ключевых коллекций
  const colls = [
    "users",
    "clinics",
    "clinic_appointments",
    "hipaa_audit_logs",
    "notifications",
  ];
  for (const c of colls) {
    try {
      health.collections[c] = await mongoose.connection.db
        .collection(c)
        .estimatedDocumentCount();
    } catch {
      health.collections[c] = null;
    }
  }

  health.node = process.version;
  health.uptimeSec = Math.round(process.uptime());

  res.json(health);
}
