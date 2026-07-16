// modules/admin/controllers/adminClinics.controller.js
//
// Платформенное администрирование КЛИНИК (только роль admin).
// Все роуты монтируются под requireAdmin (см. adminClinicsRoute.js), а каждое
// действие пишется в HIPAA-аудит (доступ к данным клиник и управление ими).
//
// Clinic сама НЕ tenant-scoped (она и есть арендатор). Связанные модели
// (ClinicMembership, ClinicPatient) tenant-scoped — для кросс-клиничных
// admin-запросов явно обходим плагин через skipTenantScope.

import mongoose from "mongoose";
import Clinic from "../../clinic/clinic-core/models/clinic.model.js";
import ClinicMembership from "../../clinic/clinic-staff/models/clinicMembership.model.js";
import ClinicPatient from "../../clinic/clinic-patients/models/clinicPatient.model.js";
import { updateClinic } from "../../clinic/clinic-core/services/clinic.service.js";
import { deleteClinicCascade } from "../../clinic/clinic-core/services/deleteClinicCascade.service.js";
import { recordActionAsync } from "../../audit/index.js";

const ALLOWED_TIERS = ["starter", "pro", "medical_tourism", "enterprise"];

function auditCtx(req) {
  return {
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
    sessionId: req.sessionID,
  };
}

function actor(req) {
  return { userId: req.userId || req.session?.userId, role: "admin" };
}

// Счётчики связанных сущностей клиники (кросс-tenant — skipTenantScope).
async function clinicCounts(clinicId) {
  const [employees, userMembers, patients] = await Promise.all([
    ClinicMembership.countDocuments({
      clinicId,
      actorType: "employee",
      leftAt: null,
    }).setOptions({ skipTenantScope: true }),
    ClinicMembership.countDocuments({
      clinicId,
      actorType: "user",
      leftAt: null,
    }).setOptions({ skipTenantScope: true }),
    ClinicPatient.countDocuments({ clinicId }).setOptions({
      skipTenantScope: true,
    }),
  ]);
  return { employees, userMembers, patients };
}

function clinicListDTO(c) {
  return {
    _id: String(c._id),
    name: c.name,
    slug: c.slug,
    tier: c.tier,
    isActive: c.isActive !== false,
    isPublished: c.isPublished === true,
    isVerified: c.isVerified === true,
    ownerId: c.ownerId ? String(c.ownerId) : null,
    city: c.address?.city || null,
    createdAt: c.createdAt,
  };
}

// ─── GET /admin/clinics ────────────────────────────────────────
// Список всех клиник. Фильтры: q (name/slug), tier, active, published.
// Пагинация: limit (по умолч. 50), skip.
export async function listClinics(req, res) {
  try {
    const { q, tier, active, published, limit = 50, skip = 0 } = req.query;
    const filter = {};

    if (q && String(q).trim()) {
      const safe = String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rx = new RegExp(safe, "i");
      filter.$or = [{ name: rx }, { slug: rx }];
    }
    if (tier && ALLOWED_TIERS.includes(tier)) filter.tier = tier;
    if (active === "true") filter.isActive = { $ne: false };
    if (active === "false") filter.isActive = false;
    if (published === "true") filter.isPublished = true;
    if (published === "false") filter.isPublished = { $ne: true };

    const lim = Math.min(Number(limit) || 50, 200);
    const sk = Math.max(Number(skip) || 0, 0);

    const [rows, total] = await Promise.all([
      Clinic.find(filter)
        .select(
          "name slug tier isActive isPublished isVerified ownerId address.city createdAt",
        )
        .sort({ createdAt: -1 })
        .skip(sk)
        .limit(lim)
        .lean(),
      Clinic.countDocuments(filter),
    ]);

    recordActionAsync({
      actor: actor(req),
      action: "list",
      resourceType: "clinic",
      outcome: "success",
      context: auditCtx(req),
      metadata: { count: rows.length, total, filters: { tier, active, published } },
    });

    res.json({ clinics: rows.map(clinicListDTO), total, limit: lim, skip: sk });
  } catch (err) {
    console.error("adminClinics.listClinics:", err);
    res.status(500).json({ message: "Server error" });
  }
}

// ─── GET /admin/clinics/stats ──────────────────────────────────
// Сводная статистика по клиникам платформы.
export async function clinicsStats(req, res) {
  try {
    const [total, active, published, verified, byTierAgg] = await Promise.all([
      Clinic.countDocuments({}),
      Clinic.countDocuments({ isActive: { $ne: false } }),
      Clinic.countDocuments({ isPublished: true }),
      Clinic.countDocuments({ isVerified: true }),
      Clinic.aggregate([{ $group: { _id: "$tier", count: { $sum: 1 } } }]),
    ]);
    const byTier = {};
    for (const t of ALLOWED_TIERS) byTier[t] = 0;
    for (const row of byTierAgg) if (row._id) byTier[row._id] = row.count;

    res.json({ total, active, blocked: total - active, published, verified, byTier });
  } catch (err) {
    console.error("adminClinics.clinicsStats:", err);
    res.status(500).json({ message: "Server error" });
  }
}

// ─── GET /admin/clinics/:id ────────────────────────────────────
// Детали одной клиники + счётчики связанных сущностей.
export async function getClinicDetail(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid clinic id" });
    }
    const clinic = await Clinic.findById(id).lean();
    if (!clinic) return res.status(404).json({ message: "Clinic not found" });

    const counts = await clinicCounts(id);

    recordActionAsync({
      actor: actor(req),
      action: "read",
      resourceType: "clinic",
      resourceId: id,
      outcome: "success",
      context: auditCtx(req),
      metadata: { ...counts },
    });

    res.json({
      clinic: {
        ...clinicListDTO(clinic),
        legalName: clinic.legalName || null,
        taxId: clinic.taxId || null,
        timezone: clinic.timezone || null,
        defaultLanguage: clinic.defaultLanguage || null,
        contacts: clinic.contacts || null,
        address: clinic.address || null,
        description: clinic.description || "",
      },
      counts,
    });
  } catch (err) {
    console.error("adminClinics.getClinicDetail:", err);
    res.status(500).json({ message: "Server error" });
  }
}

// ─── PATCH /admin/clinics/:id/active ───────────────────────────
// Блокировка / разблокировка клиники (isActive). body: { isActive: bool }
export async function setClinicActive(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid clinic id" });
    }
    const isActive = req.body?.isActive === true;
    const clinic = await Clinic.findByIdAndUpdate(
      id,
      { $set: { isActive } },
      { new: true },
    ).lean();
    if (!clinic) return res.status(404).json({ message: "Clinic not found" });

    recordActionAsync({
      actor: actor(req),
      action: "update",
      resourceType: "clinic",
      resourceId: id,
      outcome: "success",
      context: auditCtx(req),
      metadata: { field: "isActive", value: isActive },
    });

    res.json({ clinic: clinicListDTO(clinic) });
  } catch (err) {
    console.error("adminClinics.setClinicActive:", err);
    res.status(500).json({ message: "Server error" });
  }
}

// ─── PATCH /admin/clinics/:id/tier ─────────────────────────────
// Смена тарифа. body: { tier }
export async function setClinicTier(req, res) {
  try {
    const { id } = req.params;
    const { tier } = req.body || {};
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid clinic id" });
    }
    if (!ALLOWED_TIERS.includes(tier)) {
      return res.status(400).json({ message: "Invalid tier", allowed: ALLOWED_TIERS });
    }
    const clinic = await updateClinic(id, { tier });

    recordActionAsync({
      actor: actor(req),
      action: "update",
      resourceType: "clinic",
      resourceId: id,
      outcome: "success",
      context: auditCtx(req),
      metadata: { field: "tier", value: tier },
    });

    res.json({ clinic: clinicListDTO(clinic.toObject ? clinic.toObject() : clinic) });
  } catch (err) {
    console.error("adminClinics.setClinicTier:", err);
    res.status(err.statusCode || 500).json({ message: err.message || "Server error" });
  }
}

// ─── PATCH /admin/clinics/:id/verify ───────────────────────────
// Верификация клиники. body: { isVerified: bool }
export async function setClinicVerified(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid clinic id" });
    }
    const isVerified = req.body?.isVerified === true;
    const clinic = await Clinic.findByIdAndUpdate(
      id,
      { $set: { isVerified } },
      { new: true },
    ).lean();
    if (!clinic) return res.status(404).json({ message: "Clinic not found" });

    recordActionAsync({
      actor: actor(req),
      action: "update",
      resourceType: "clinic",
      resourceId: id,
      outcome: "success",
      context: auditCtx(req),
      metadata: { field: "isVerified", value: isVerified },
    });

    res.json({ clinic: clinicListDTO(clinic) });
  } catch (err) {
    console.error("adminClinics.setClinicVerified:", err);
    res.status(500).json({ message: "Server error" });
  }
}

// ─── DELETE /admin/clinics/:id ─────────────────────────────────
// ПОЛНОЕ каскадное удаление клиники (необратимо). Требует точное имя клиники
// в body.confirmationName. Обходит owner-гейт (bypassOwnerCheck), т.к.
// вызывающий — платформенный админ (проверено requireAdmin).
export async function deleteClinic(req, res) {
  try {
    const { id } = req.params;
    const { confirmationName } = req.body || {};
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid clinic id" });
    }

    await deleteClinicCascade({
      clinicId: id,
      actorUserId: req.userId || req.session?.userId,
      confirmationName,
      bypassOwnerCheck: true, // admin override
    });

    recordActionAsync({
      actor: actor(req),
      action: "delete",
      resourceType: "clinic",
      resourceId: id,
      outcome: "success",
      context: auditCtx(req),
      metadata: { cascade: true },
    });

    res.json({ success: true });
  } catch (err) {
    console.error("adminClinics.deleteClinic:", err);
    res
      .status(err.statusCode || 500)
      .json({ message: err.message || "Server error", details: err.details || null });
  }
}
