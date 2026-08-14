// modules/admin/controllers/adminDashboard.controller.js
//
// Данные для главной страницы админпанели.
//
// ЗАЧЕМ ОТДЕЛЬНО ОТ /admin/overview. Тот отдаёт голые итоги по два десятка
// коллекций — «сколько всего». Для стартовой страницы этого мало: цифра без
// динамики ничего не говорит (1244 пользователя — это много или мало?), а
// главное, она не подсказывает, что делать. Здесь к каждому числу идёт
// прирост за период, отдельным блоком — очередь дел, и одним запросом,
// а не восемью: страница должна открываться сразу.
//
// ЧТО СЮДА НЕ ПОПАДАЕТ. Ни одного персонального данного: только счётчики и
// агрегаты. Список последних действий берётся из HIPAA-журнала, где по
// устройству лежат тип действия и тип ресурса, но не содержимое.

import mongoose from "mongoose";
import os from "node:os";
import { HIPAAAuditLog } from "../../audit/index.js";
import { auditAdminAccess } from "../adminAudit.js";

/** Счётчик, который не роняет всю страницу из-за одной отсутствующей коллекции. */
async function count(collection, filter = {}) {
  try {
    return await mongoose.connection.db
      .collection(collection)
      .countDocuments(filter);
  } catch {
    return 0;
  }
}

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

/**
 * Счётчик с динамикой: всего, за период, и насколько это больше прошлого
 * такого же периода.
 *
 * Процент считаем только когда прошлый период был непустым: рост с нуля до
 * трёх — это не «+300 %», а просто три; такая подпись вводит в заблуждение.
 */
async function metric(collection, dateField = "createdAt", days = 30) {
  const now = Date.now();
  const from = new Date(now - days * 864e5);
  const prevFrom = new Date(now - 2 * days * 864e5);

  const [total, current, previous, today] = await Promise.all([
    count(collection),
    count(collection, { [dateField]: { $gte: from } }),
    count(collection, { [dateField]: { $gte: prevFrom, $lt: from } }),
    count(collection, { [dateField]: { $gte: startOfToday() } }),
  ]);

  return {
    total,
    today,
    period: current,
    trend: previous > 0 ? Math.round(((current - previous) / previous) * 100) : null,
  };
}

/** Регистрации по дням — для спарклайна за две недели. */
async function dailySeries(collection, dateField = "createdAt", days = 14) {
  try {
    const from = daysAgo(days - 1);
    from.setHours(0, 0, 0, 0);

    const rows = await mongoose.connection.db
      .collection(collection)
      .aggregate([
        { $match: { [dateField]: { $gte: from } } },
        {
          $group: {
            _id: {
              $dateToString: { format: "%Y-%m-%d", date: `$${dateField}` },
            },
            n: { $sum: 1 },
          },
        },
      ])
      .toArray();

    const byDay = new Map(rows.map((r) => [r._id, r.n]));
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = daysAgo(i);
      const key = d.toISOString().slice(0, 10);
      out.push({ date: key, value: byDay.get(key) || 0 });
    }
    return out;
  } catch {
    return [];
  }
}

// ─── GET /admin/dashboard ──────────────────────────────────────
export async function getDashboard(req, res) {
  try {
    const [
      users,
      appointments,
      consultations,
      clinics,
      // Очередь дел
      pendingDoctors,
      pendingReviews,
      pendingArticles,
      blockedUsers,
      deniedToday,
      radiologyDrafts,
      // Разделы платформы
      doctors,
      patients,
      clinicPatients,
      articles,
      radiologyCases,
      labCases,
      vpCases,
      examItems,
      examAttempts,
      simulations,
      diagnosticCases,
      medicalCodes,
      leads,
      notifications,
      // Графики и лента
      usersSeries,
      appointmentsSeries,
      recentAudit,
    ] = await Promise.all([
      metric("users"),
      metric("clinic_appointments"),
      metric("consultations"),
      metric("clinics"),

      count("doctorprofiles", { verificationStatus: "pending" }),
      count("clinic_reviews", { status: "pending" }),
      count("clinicarticles", { status: "pending" }),
      count("users", { isBlocked: true }),
      HIPAAAuditLog.countDocuments({
        outcome: "denied",
        createdAt: { $gte: daysAgo(1) },
      }).catch(() => 0),
      count("radiology_cases", { status: "draft" }),

      count("users", { role: "doctor" }),
      count("users", { role: "patient" }),
      count("clinic_patients"),
      count("articles"),
      count("radiology_cases"),
      count("lab_cases"),
      count("vp_cases"),
      count("exam_items"),
      count("exam_attempts"),
      count("simulationplans"),
      count("diagnostic_cases"),
      count("medicalcodes"),
      count("leads"),
      count("notifications"),

      dailySeries("users"),
      dailySeries("clinic_appointments"),
      HIPAAAuditLog.find({})
        .sort({ createdAt: -1 })
        .limit(12)
        .select("action resourceType outcome createdAt")
        .lean()
        .catch(() => []),
    ]);

    // Здоровье процесса. Mongo проверяем по состоянию соединения, а не
    // отдельным ping-ом: лишний запрос на каждой загрузке страницы ни к чему.
    const mem = process.memoryUsage();
    const health = {
      mongo: mongoose.connection.readyState === 1,
      uptimeSec: Math.round(process.uptime()),
      heapUsedMb: Math.round(mem.heapUsed / 1048576),
      heapTotalMb: Math.round(mem.heapTotal / 1048576),
      loadAvg: Number((os.loadavg()[0] || 0).toFixed(2)),
      node: process.version,
    };

    auditAdminAccess(req, {
      action: "list",
      resourceType: "other",
      metadata: { view: "dashboard" },
    });

    res.json({
      generatedAt: new Date().toISOString(),
      metrics: { users, appointments, consultations, clinics },
      // Очередь дел: всё, что ждёт решения человека.
      queue: {
        doctorVerification: pendingDoctors,
        reviews: pendingReviews,
        clinicArticles: pendingArticles,
        blockedUsers,
        deniedLast24h: deniedToday,
        radiologyDrafts,
      },
      sections: {
        doctors,
        patients,
        clinicPatients,
        articles,
        radiologyCases,
        labCases,
        vpCases,
        examItems,
        examAttempts,
        simulations,
        diagnosticCases,
        medicalCodes,
        leads,
        notifications,
      },
      series: { users: usersSeries, appointments: appointmentsSeries },
      activity: (recentAudit || []).map((r) => ({
        action: r.action,
        resourceType: r.resourceType,
        outcome: r.outcome,
        at: r.createdAt,
      })),
      health,
    });
  } catch (err) {
    console.error("adminDashboard.getDashboard:", err);
    res.status(500).json({ message: "Server error" });
  }
}

export default { getDashboard };
