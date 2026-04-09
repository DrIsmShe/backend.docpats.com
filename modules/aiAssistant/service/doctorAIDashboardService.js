import AISummaryCache from "../model/AISummaryCache.js";
import DoctorAIDashboard from "../model/DoctorAIDashboard.js";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";
import DoctorPrivatePatient from "../../../common/models/Polyclinic/DoctorPrivatePatient.js";
import ProfileDoctor from "../../../common/models/DoctorProfile/profileDoctor.js";

const OVERDUE_MONTHS = 6;
const DEBUG = process.env.NODE_ENV !== "production";
const log = (...args) => DEBUG && console.log("[AIDashboard]", ...args);

const monthsDiff = (date) => {
  if (!date) return Infinity;
  return (Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24 * 30);
};
const riskScore = (level) =>
  level === "high" ? 3 : level === "moderate" ? 2 : 1;

const topRiskDomain = (fra = {}) => {
  let best = { domain: "", level: "low", reason: "", score: 0 };
  for (const [domain, node] of Object.entries(fra)) {
    const s = riskScore(node?.level);
    if (s > best.score)
      best = {
        domain,
        level: node.level,
        reason: node.reasons?.[0] || "",
        score: s,
      };
  }
  return best;
};

export const computeDoctorAIDashboard = async (doctorId) => {
  log("Start for doctorId (ProfileDoctor._id):", doctorId.toString());

  // Находим userId врача — нужен для NewPatientPolyclinic.doctorId[]
  const doctorProfile = await ProfileDoctor.findById(doctorId)
    .select("userId")
    .lean();
  const doctorUserId = doctorProfile?.userId;

  if (!doctorUserId) {
    log("ERROR: doctorProfile not found for doctorId:", doctorId.toString());
    return;
  }
  log("doctorUserId:", doctorUserId.toString());

  // NewPatientPolyclinic: поле doctorId — массив User._id
  // DoctorPrivatePatient: поле doctorUserId — User._id (видно из лога countDocuments)
  const [polyPatients, privatePatients] = await Promise.all([
    NewPatientPolyclinic.find({
      doctorId: { $in: [doctorUserId] },
      isDeleted: { $ne: true },
    })
      .select("_id firstNameEncrypted lastNameEncrypted")
      .then((docs) =>
        docs.map((d) => ({
          _id: d._id,
          patientName:
            `${d.firstName || ""} ${d.lastName || ""}`.trim() || "Пациент",
        })),
      ),

    DoctorPrivatePatient.find({
      doctorUserId: doctorUserId, // ← doctorUserId, не doctorProfileId
      isDeleted: { $ne: true },
    })
      .select("_id firstNameEncrypted lastNameEncrypted")
      .then((docs) =>
        docs.map((d) => ({
          _id: d._id,
          patientName:
            `${d.firstName || ""} ${d.lastName || ""}`.trim() || "Пациент",
        })),
      ),
  ]);

  log(
    `Patients found — poly: ${polyPatients.length}, private: ${privatePatients.length}`,
  );

  const allPatients = [...polyPatients, ...privatePatients];
  const totalPatients = allPatients.length;

  if (totalPatients === 0) {
    log("No patients — saving empty dashboard");
    await DoctorAIDashboard.findOneAndUpdate(
      { doctorId },
      {
        doctorId,
        totalPatients: 0,
        analyzedPatients: 0,
        highRiskPatients: [],
        moderateRiskPatients: [],
        overduePatients: [],
        complicationForecast: [],
        computedAt: new Date(),
      },
      { upsert: true, new: true },
    );
    return;
  }

  // AISummaryCache
  const patientIds = allPatients.map((p) => p._id);
  const caches = await AISummaryCache.find({ patientId: { $in: patientIds } })
    .sort({ createdAt: -1 })
    .lean();

  log(`AISummaryCache hits: ${caches.length}/${totalPatients}`);

  if (caches.length === 0) {
    const total = await AISummaryCache.countDocuments({});
    log(`Total AISummaryCache docs in DB: ${total}`);
    if (total > 0) {
      const sample = await AISummaryCache.findOne().lean();
      log(
        `Cache sample patientId: ${sample?.patientId} | our ids[0]: ${patientIds[0]}`,
      );
    }
  }

  const cacheByPatient = new Map();
  for (const c of caches) {
    const key = c.patientId.toString();
    if (!cacheByPatient.has(key)) cacheByPatient.set(key, c);
  }

  const highRisk = [],
    moderateRisk = [],
    overdue = [];
  const complicationAccum = {
    "Диабетическая нефропатия": { sum: 0, count: 0 },
    Инсульт: { sum: 0, count: 0 },
    Инфаркт: { sum: 0, count: 0 },
    "Сердечная недостаточность": { sum: 0, count: 0 },
    "Онкологический риск": { sum: 0, count: 0 },
  };
  let analyzedCount = 0;

  for (const patient of allPatients) {
    const pid = patient._id.toString();
    const cached = cacheByPatient.get(pid);

    const lastAnalyzedAt = cached?.createdAt || null;
    const overdueMonthsVal = monthsDiff(lastAnalyzedAt);
    const isOverdue = overdueMonthsVal > OVERDUE_MONTHS;

    const entry = {
      patientId: patient._id,
      patientName: patient.patientName,
      topRiskDomain: "",
      topRiskLevel: "low",
      topRiskReason: "",
      alertCount: 0,
      highAlertCount: 0,
      topAlert: null,
      clinicalSeverity: "low",
      hospitalizationRisk: 0,
      deteriorationRisk: 0,
      lastAnalyzedAt,
      lastExamDate: null,
      isOverdue,
      overdueMonths: isOverdue ? Math.round(overdueMonthsVal) : 0,
    };

    if (cached?.summary) {
      analyzedCount++;
      const s = cached.summary;
      log(
        `  ${patient.patientName}: severity=${s.clinicalSeverity}, alerts=${s.clinicalAlerts?.length}`,
      );

      const top = topRiskDomain(s.fullRiskAssessment);
      Object.assign(entry, {
        topRiskDomain: top.domain,
        topRiskLevel: top.level,
        topRiskReason: top.reason,
        alertCount: (s.clinicalAlerts || []).length,
        highAlertCount: (s.clinicalAlerts || []).filter(
          (a) => a.level === "high",
        ).length,
        topAlert: s.clinicalAlerts?.[0] || null,
        clinicalSeverity: s.clinicalSeverity || "low",
      });

      for (const p of s.prognosis || []) {
        if (p.target === "hospitalization_30d")
          entry.hospitalizationRisk = p.probability || 0;
        if (p.target === "deterioration_72h")
          entry.deteriorationRisk = p.probability || 0;
      }

      const fra = s.fullRiskAssessment || {};
      if (fra.nephrology?.level !== "low") {
        complicationAccum["Диабетическая нефропатия"].sum +=
          fra.nephrology?.confidence || 0.15;
        complicationAccum["Диабетическая нефропатия"].count++;
      }
      if (fra.neurology?.level !== "low") {
        complicationAccum["Инсульт"].sum += fra.neurology?.confidence || 0.12;
        complicationAccum["Инсульт"].count++;
      }
      if (fra.cardiology?.level !== "low") {
        complicationAccum["Инфаркт"].sum += fra.cardiology?.confidence || 0.18;
        complicationAccum["Инфаркт"].count++;
        complicationAccum["Сердечная недостаточность"].sum +=
          (fra.cardiology?.confidence || 0.1) * 0.7;
        complicationAccum["Сердечная недостаточность"].count++;
      }
      if (fra.oncology?.level !== "low") {
        complicationAccum["Онкологический риск"].sum +=
          fra.oncology?.confidence || 0.1;
        complicationAccum["Онкологический риск"].count++;
      }

      if (top.level === "high" || entry.clinicalSeverity === "high")
        highRisk.push(entry);
      else if (
        top.level === "moderate" ||
        entry.clinicalSeverity === "moderate"
      )
        moderateRisk.push(entry);
    }

    if (isOverdue) overdue.push(entry);
  }

  log(
    `Result — high:${highRisk.length}, moderate:${moderateRisk.length}, overdue:${overdue.length}, analyzed:${analyzedCount}/${totalPatients}`,
  );

  const sortByRisk = (a, b) =>
    riskScore(b.topRiskLevel) - riskScore(a.topRiskLevel) ||
    b.highAlertCount - a.highAlertCount;
  highRisk.sort(sortByRisk);
  moderateRisk.sort(sortByRisk);
  overdue.sort((a, b) => b.overdueMonths - a.overdueMonths);

  const complicationForecast = Object.entries(complicationAccum)
    .filter(([, v]) => v.count > 0)
    .map(([name, v]) => ({
      name,
      probability: Math.min(v.sum / totalPatients, 1),
      patientCount: v.count,
    }))
    .sort((a, b) => b.probability - a.probability);

  await DoctorAIDashboard.findOneAndUpdate(
    { doctorId },
    {
      doctorId,
      totalPatients,
      analyzedPatients: analyzedCount,
      highRiskPatients: highRisk.slice(0, 20),
      moderateRiskPatients: moderateRisk.slice(0, 20),
      overduePatients: overdue.slice(0, 20),
      complicationForecast,
      computedAt: new Date(),
    },
    { upsert: true, new: true },
  );

  log("Saved successfully.");
};
