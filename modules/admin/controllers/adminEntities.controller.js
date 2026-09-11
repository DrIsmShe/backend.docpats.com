// modules/admin/controllers/adminEntities.controller.js
//
// Admin-обзор врачей и приёмов + рассылка системных уведомлений.
// Всё под requireAdmin (см. adminEntitiesRoute.js) + HIPAA-аудит.

import mongoose from "mongoose";
import User, { decrypt } from "../../../common/models/Auth/users.js";
import DoctorProfile from "../../../common/models/DoctorProfile/profileDoctor.js";
import { notifyMany } from "../../notifications/services/notification.service.js";
import { auditAdminAccess } from "../adminAudit.js";
import DoctorVerificationDocument from "../../../common/models/DoctorVerification/DocumentFiles.js";
import { действуетДо } from "../../../common/models/DoctorProfile/profileDoctor.js";
import { чегоНеХватает } from "../services/doctorVerification.service.js";

const safe = (v) => {
  try {
    return v ? decrypt(v) : null;
  } catch {
    return null;
  }
};
const countColl = async (name, filter = {}) => {
  try {
    return await mongoose.connection.db.collection(name).countDocuments(filter);
  } catch {
    return 0;
  }
};

// ─── GET /admin/doctors ────────────────────────────────────────
// Обзор врачей: список (User role=doctor) + флаг верификации из DoctorProfile.
// Фильтры: q (email/username), verified. Пагинация.
export async function listDoctors(req, res) {
  try {
    const { q, verified, limit = 50, skip = 0 } = req.query;
    const filter = { role: "doctor" };
    if (q && String(q).trim()) {
      const rx = new RegExp(
        String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i",
      );
      filter.$or = [{ username: rx }];
    }
    const lim = Math.min(Number(limit) || 50, 200);
    const sk = Math.max(Number(skip) || 0, 0);

    const [users, total] = await Promise.all([
      User.find(filter)
        .select(
          "username emailEncrypted firstNameEncrypted lastNameEncrypted isBlocked country createdAt",
        )
        .sort({ createdAt: -1 })
        .skip(sk)
        .limit(lim)
        .lean(),
      User.countDocuments(filter),
    ]);

    const ids = users.map((u) => u._id);
    const profiles = await DoctorProfile.find({ userId: { $in: ids } })
      .select("userId isVerified specializationInstitution clinic")
      .lean();
    const pmap = new Map(profiles.map((p) => [String(p.userId), p]));

    let rows = users.map((u) => {
      const p = pmap.get(String(u._id));
      return {
        _id: String(u._id),
        username: u.username,
        email: safe(u.emailEncrypted),
        firstName: safe(u.firstNameEncrypted),
        lastName: safe(u.lastNameEncrypted),
        isBlocked: u.isBlocked === true,
        isVerified: p?.isVerified === true,
        specialization: p?.specializationInstitution || null,
        clinic: p?.clinic || null,
        country: u.country || null,
        createdAt: u.createdAt,
      };
    });
    if (verified === "true") rows = rows.filter((r) => r.isVerified);
    if (verified === "false") rows = rows.filter((r) => !r.isVerified);

    auditAdminAccess(req, {
      action: "list",
      resourceType: "doctor-profile",
      metadata: { count: rows.length },
    });

    res.json({ doctors: rows, total, limit: lim, skip: sk });
  } catch (err) {
    console.error("adminEntities.listDoctors:", err);
    res.status(500).json({ message: "Server error" });
  }
}

// ─── GET /admin/appointments-overview ──────────────────────────
// Сводка по приёмам платформы (клиника + legacy). Без PHI — только счётчики.
export async function appointmentsOverview(req, res) {
  try {
    const [clinicTotal, scheduled, completed, cancelled, legacyTotal] =
      await Promise.all([
        countColl("clinic_appointments"),
        countColl("clinic_appointments", { status: "scheduled" }),
        countColl("clinic_appointments", { status: "completed" }),
        countColl("clinic_appointments", { status: "cancelled" }),
        countColl("appointments"),
      ]);

    res.json({
      clinic: { total: clinicTotal, scheduled, completed, cancelled },
      legacy: { total: legacyTotal },
    });
  } catch (err) {
    console.error("adminEntities.appointmentsOverview:", err);
    res.status(500).json({ message: "Server error" });
  }
}

// ─── POST /admin/notifications/broadcast ───────────────────────
// Рассылка системного уведомления. body: { title, message, role? }
// role: "doctor" | "patient" | опустить = всем пользователям.
export async function broadcastNotification(req, res) {
  try {
    const { title, message, role } = req.body || {};
    if (!title || !message) {
      return res.status(400).json({ message: "title и message обязательны" });
    }
    const filter = {};
    if (role === "doctor" || role === "patient") filter.role = role;

    const users = await User.find(filter).select("_id").lean();
    const ids = users.map((u) => u._id);

    await notifyMany(ids, {
      type: "system_message",
      title: String(title).slice(0, 200),
      message: String(message).slice(0, 2000),
    });

    auditAdminAccess(req, {
      action: "create",
      resourceType: "other",
      metadata: { view: "broadcast", recipients: ids.length, role: role || "all" },
    });

    res.json({ success: true, recipients: ids.length });
  } catch (err) {
    console.error("adminEntities.broadcastNotification:", err);
    res.status(500).json({ message: "Server error" });
  }
}

/* ─── GET /admin/verification-queue ─────────────────────────────
 *
 * ЗДЕСЬ БЫЛА ПОЛОМКА, ИЗ-ЗА КОТОРОЙ АДМИНИСТРАТОР РЕШАЛ ВСЛЕПУЮ.
 *
 * Очередь читала profile.verificationDocuments — массив строк-адресов на
 * самом профиле. Врач же загружает документы в отдельную коллекцию
 * DoctorVerificationDocument (modules/doctorsProfiles/controllers/
 * addVerificationDocumentsController.js), и в profile.verificationDocuments
 * не пишет НИЧЕГО, кроме формы ручной правки карточки администратором.
 *
 * То есть в очереди у каждого врача стояло «документы не приложены»
 * независимо от того, сколько он их прислал, а решение «одобрить»
 * принималось без единого документа перед глазами.
 *
 * Теперь очередь читает ту коллекцию, куда врач кладёт: с видом
 * документа, сроком, органом выдачи и признаком сверки даты. И
 * показывает, чего не хватает до полного набора, — чтобы отказ
 * «не хватает документов» не приходил неожиданностью после нажатия.
 *
 * В очередь попадают не только pending: истёкшие и приостановленные
 * допуски — тоже работа администратора, только другая (продлить,
 * восстановить). Раньше они не были видны нигде.
 */
const СОСТОЯНИЯ_ОЧЕРЕДИ = ["pending", "expired", "suspended"];

export async function verificationQueue(req, res) {
  try {
    const profiles = await DoctorProfile.find({
      verificationStatus: { $in: СОСТОЯНИЯ_ОЧЕРЕДИ },
    })
      .select(
        "userId verificationStatus verificationExpiresAt verificationExtendedUntil " +
          "verificationExtensionReason verificationReviewComment " +
          "specializationInstitution clinic country educationInstitution updatedAt",
      )
      .sort({ updatedAt: 1 })
      .lean();

    const userIds = profiles.map((p) => p.userId).filter(Boolean);
    const users = await User.find({ _id: { $in: userIds } })
      .select("username emailEncrypted firstNameEncrypted lastNameEncrypted")
      .lean();
    const umap = new Map(users.map((u) => [String(u._id), u]));

    /* Документы одним запросом на всю очередь, а не по одному на врача:
       в очереди бывает под сотню карточек. */
    const документы = await DoctorVerificationDocument.find({
      doctorProfileId: { $in: profiles.map((p) => p._id) },
    })
      .select(
        "doctorProfileId documentType status fileUrl fileName isArchivedByDoctor " +
          "expiresAt expiryConfirmed issuedAt documentNumber issuingAuthority " +
          "jurisdictionCode reviewComment createdAt",
      )
      .sort({ createdAt: -1 })
      .lean();

    const поПрофилю = new Map();
    for (const д of документы) {
      const ключ = String(д.doctorProfileId);
      if (!поПрофилю.has(ключ)) поПрофилю.set(ключ, []);
      поПрофилю.get(ключ).push(д);
    }

    const queue = profiles.map((p) => {
      const u = umap.get(String(p.userId));
      const свои = поПрофилю.get(String(p._id)) || [];
      /* При подсчёте нехватки документ на проверке считаем как одобренный:
         администратор смотрит очередь именно затем, чтобы его одобрить, и
         список «чего не хватает» должен показывать, чего НЕТ ВООБЩЕ, а не
         чего он ещё не успел нажать. */
      const сУчётомРешения = свои.map((д) =>
        д.status === "pending" ? { ...д, status: "approved" } : д,
      );

      return {
        profileId: String(p._id),
        userId: p.userId ? String(p.userId) : null,
        username: u?.username || null,
        firstName: safe(u?.firstNameEncrypted),
        lastName: safe(u?.lastNameEncrypted),
        email: safe(u?.emailEncrypted),
        specialization: p.specializationInstitution || null,
        education: p.educationInstitution || null,
        clinic: p.clinic || null,
        country: p.country || null,

        status: p.verificationStatus,
        accessExpiresAt: действуетДо(p),
        expiresAtByDocuments: p.verificationExpiresAt || null,
        extendedUntil: p.verificationExtendedUntil || null,
        extensionReason: p.verificationExtensionReason || "",
        reviewComment: p.verificationReviewComment || "",

        documentsCount: свои.filter((д) => !д.isArchivedByDoctor).length,
        missing: чегоНеХватает(сУчётомРешения),
        documents: свои.map((д) => ({
          id: String(д._id),
          type: д.documentType,
          status: д.status,
          url: д.fileUrl,
          name: д.fileName || null,
          archived: Boolean(д.isArchivedByDoctor),
          number: д.documentNumber || null,
          authority: д.issuingAuthority || null,
          jurisdiction: д.jurisdictionCode || null,
          issuedAt: д.issuedAt || null,
          expiresAt: д.expiresAt || null,
          expiryConfirmed: Boolean(д.expiryConfirmed),
          reviewComment: д.reviewComment || "",
          uploadedAt: д.createdAt,
        })),
        submittedAt: p.updatedAt,
      };
    });

    auditAdminAccess(req, {
      action: "list",
      resourceType: "doctor-profile",
      metadata: { view: "verification-queue", count: queue.length },
    });

    res.json({ queue, total: queue.length });
  } catch (err) {
    console.error("adminEntities.verificationQueue:", err);
    res.status(500).json({ message: "Server error" });
  }
}
