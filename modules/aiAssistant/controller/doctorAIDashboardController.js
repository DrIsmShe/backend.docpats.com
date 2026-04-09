import ProfileDoctor from "../../../common/models/DoctorProfile/profileDoctor.js";
import DoctorAIDashboard from "../model/DoctorAIDashboard.js";
import { computeDoctorAIDashboard } from "../service/doctorAIDashboardService.js";

const CACHE_TTL_HOURS = 12;

/* ── Преобразует внутреннюю структуру в формат ожидаемый фронтом ── */
const toFrontendShape = (raw) => {
  if (!raw) return null;

  const highRiskPatients = (raw.highRiskPatients || []).map(mapSnapshot);
  const moderateRiskPatients = (raw.moderateRiskPatients || []).map(
    mapSnapshot,
  );
  const overduePatients = (raw.overduePatients || []).map(mapSnapshot);

  // patientsWithAlerts — все у кого есть хотя бы один алерт
  const patientsWithAlerts = [...highRiskPatients, ...moderateRiskPatients]
    .filter((s) => s.clinicalAlerts?.length > 0)
    .slice(0, 15);

  // aggregatedPrognosis
  const allPatients = [...highRiskPatients, ...moderateRiskPatients];
  const withHosp = allPatients.filter((p) => p.hospitalizationRisk > 0);
  const withDet = allPatients.filter((p) => p.deteriorationRisk > 0);

  const avgHospitalizationRisk = withHosp.length
    ? withHosp.reduce((s, p) => s + p.hospitalizationRisk, 0) / withHosp.length
    : 0;
  const avgDeteriorationRisk = withDet.length
    ? withDet.reduce((s, p) => s + p.deteriorationRisk, 0) / withDet.length
    : 0;

  const highHospitalizationCount = allPatients.filter(
    (p) => p.hospitalizationRisk > 0.5,
  ).length;
  const highDeteriorationCount = allPatients.filter(
    (p) => p.deteriorationRisk > 0.5,
  ).length;

  // domainRiskSummary — из complicationForecast (ближайшее что есть)
  const domainRiskSummary = buildDomainSummary([
    ...highRiskPatients,
    ...moderateRiskPatients,
  ]);

  return {
    dashboard: {
      generatedAt: raw.computedAt,
      totalPatientsAnalyzed: raw.totalPatients,
      totalPatientsWithCache: raw.analyzedPatients,
      highRiskPatients,
      moderateRiskPatients,
      patientsWithAlerts,
      patientsWithoutRecentExams: overduePatients,
      aggregatedPrognosis: {
        avgHospitalizationRisk,
        avgDeteriorationRisk,
        highHospitalizationCount,
        highDeteriorationCount,
      },
      domainRiskSummary,
      complicationForecast: raw.complicationForecast || [],
    },
    fromCache: true,
  };
};

/* Маппинг одной записи пациента в snapshot-формат фронта */
const mapSnapshot = (p) => ({
  patientId: p.patientId,
  patientName: p.patientName,
  topRiskLevel: p.topRiskLevel || "low",
  topRiskDomain: p.topRiskDomain || "",
  topRiskReason: p.topRiskReason || "",
  clinicalSeverity: p.clinicalSeverity || "low",
  aiConfidence: p.aiConfidence || 0,
  hospitalizationRisk: p.hospitalizationRisk || 0,
  deteriorationRisk: p.deteriorationRisk || 0,
  daysSinceLastExam: p.overdueMonths ? Math.round(p.overdueMonths * 30) : 0,
  // Алерты — topAlert оборачиваем в массив для совместимости
  clinicalAlerts: p.topAlert ? [p.topAlert] : [],
  highRisks: p.topRiskLevel === "high" ? [{ domain: p.topRiskDomain }] : [],
  lastAnalyzedAt: p.lastAnalyzedAt,
});

/* Строим domainRiskSummary из списка пациентов */
const KNOWN_DOMAINS = [
  "cardiology",
  "pulmonology",
  "neurology",
  "gastroenterology",
  "hepatology",
  "nephrology",
  "endocrinology",
  "hematology",
  "infectious",
  "rheumatology",
  "oncology",
];

const buildDomainSummary = (patients) => {
  const counts = {};
  for (const p of patients) {
    if (!p.topRiskDomain) continue;
    if (!counts[p.topRiskDomain])
      counts[p.topRiskDomain] = { highCount: 0, moderateCount: 0 };
    if (p.topRiskLevel === "high") counts[p.topRiskDomain].highCount++;
    if (p.topRiskLevel === "moderate") counts[p.topRiskDomain].moderateCount++;
  }
  return Object.entries(counts)
    .map(([domain, c]) => ({ domain, ...c }))
    .sort(
      (a, b) => b.highCount - a.highCount || b.moderateCount - a.moderateCount,
    );
};

/* ── GET /doctor-dashboard ── */
export const getDoctorAIDashboard = async (req, res) => {
  try {
    if (!req.user?._id)
      return res.status(401).json({ message: "Unauthorized" });

    const doctorProfile = await ProfileDoctor.findOne({
      userId: req.user._id,
    }).lean();
    if (!doctorProfile || doctorProfile.verificationStatus !== "approved")
      return res
        .status(403)
        .json({ message: "AI Dashboard available only for verified doctors" });

    const doctorId = doctorProfile._id;
    let raw = await DoctorAIDashboard.findOne({ doctorId }).lean();

    const isStale =
      !raw ||
      Date.now() - new Date(raw.computedAt).getTime() >
        CACHE_TTL_HOURS * 3600_000;

    if (isStale) {
      await computeDoctorAIDashboard(doctorId);
      raw = await DoctorAIDashboard.findOne({ doctorId }).lean();
    }

    return res.json(
      toFrontendShape(raw) || {
        dashboard: {
          generatedAt: new Date(),
          totalPatientsAnalyzed: 0,
          totalPatientsWithCache: 0,
          highRiskPatients: [],
          moderateRiskPatients: [],
          patientsWithAlerts: [],
          patientsWithoutRecentExams: [],
          aggregatedPrognosis: {
            avgHospitalizationRisk: 0,
            avgDeteriorationRisk: 0,
            highHospitalizationCount: 0,
            highDeteriorationCount: 0,
          },
          domainRiskSummary: [],
          complicationForecast: [],
        },
        fromCache: false,
      },
    );
  } catch (err) {
    console.error("Doctor AI Dashboard error:", err);
    return res.status(500).json({ message: "Dashboard computation failed" });
  }
};

/* ── POST /doctor-dashboard/refresh ── */
export const refreshDoctorAIDashboard = async (req, res) => {
  try {
    if (!req.user?._id)
      return res.status(401).json({ message: "Unauthorized" });

    const doctorProfile = await ProfileDoctor.findOne({
      userId: req.user._id,
    }).lean();
    if (!doctorProfile || doctorProfile.verificationStatus !== "approved")
      return res.status(403).json({ message: "Forbidden" });

    await computeDoctorAIDashboard(doctorProfile._id);
    const raw = await DoctorAIDashboard.findOne({
      doctorId: doctorProfile._id,
    }).lean();

    return res.json(toFrontendShape(raw));
  } catch (err) {
    console.error("Dashboard refresh error:", err);
    return res.status(500).json({ message: "Refresh failed" });
  }
};
