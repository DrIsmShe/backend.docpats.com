// server/modules/admin/controllers/adminDatabase.controller.js
//
// Раздел «База данных» админпанели — сводная аналитика по платформе:
// пациенты (кол-во, возраст, страны, пол, статус, диагнозы), статьи
// (кол-во, категории, специальности, страны авторов, языки, просмотры),
// врачи (верификация, специальности, страны) и пользователи (роли, рост).
//
// Всё считается агрегациями Mongo по требованию (кнопка «Обновить»).
// PHI сюда не попадает: возвращаются только счётчики и структурные разрезы.

import User from "../../../common/models/Auth/users.js";
import Article from "../../../common/models/Articles/articles.js";
import Category from "../../../common/models/Articles/articlesCategories.js";
import Specialization from "../../../common/models/DoctorProfile/specialityOfDoctor.js";
import ProfileDoctor from "../../../common/models/DoctorProfile/profileDoctor.js";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";
import MedicalHistory from "../../../common/models/Polyclinic/MedicalHistory/newPatientMedicalHistory.js";
import { buildAnalyticsPdf } from "../services/analyticsPdf.service.js";
import { sendEmailWithAttachment } from "../services/emailService.js";

const NA = "Не указано";
const TOP = 20;

// [{ _id, count }] → [{ label, count }] с подстановкой запасного лейбла.
const norm = (rows, fallback = NA) =>
  (rows || []).map((r) => ({
    label:
      r._id === null || r._id === undefined || r._id === ""
        ? fallback
        : String(r._id),
    count: r.count,
  }));

const byField = (Model, field, fallback = NA, limit = TOP) =>
  Model.aggregate([
    { $group: { _id: { $ifNull: [`$${field}`, fallback] }, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: limit },
  ]);

export async function computeAnalytics() {
  const [
      patientCards,
      patientUsers,
      patAge,
      patCountry,
      patGender,
      patStatus,
      patDiagnosis,
      artSummary,
      artByCategory,
      artByLanguage,
      artByAuthorCountry,
      artBySpecialization,
      artTopAuthors,
      docByVerification,
      docByCountry,
      docBySpecialization,
      usersByRole,
      usersByMonth,
      usersTotal,
    ] = await Promise.all([
      // ---------- Пациенты ----------
      NewPatientPolyclinic.countDocuments(),
      User.countDocuments({ role: "patient" }),
      NewPatientPolyclinic.aggregate([
        { $match: { birthDate: { $ne: null } } },
        {
          $addFields: {
            age: {
              $dateDiff: {
                startDate: "$birthDate",
                endDate: "$$NOW",
                unit: "year",
              },
            },
          },
        },
        {
          $bucket: {
            groupBy: "$age",
            boundaries: [0, 18, 30, 46, 60, 200],
            default: "unknown",
            output: { count: { $sum: 1 } },
          },
        },
      ]),
      byField(NewPatientPolyclinic, "country"),
      byField(NewPatientPolyclinic, "gender"),
      byField(NewPatientPolyclinic, "status"),
      // Группируем по ICD-заголовку (mainDiagnosis.codeTitle): он стандартный
      // и НЕ PHI, поэтому не шифруется. Свободный текст diagnosis теперь
      // зашифрован (случайный IV) — по нему группировать нельзя.
      MedicalHistory.aggregate([
        { $match: { "mainDiagnosis.codeTitle": { $nin: [null, ""] } } },
        { $group: { _id: "$mainDiagnosis.codeTitle", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: TOP },
      ]),

      // ---------- Статьи ----------
      Article.aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            published: { $sum: { $cond: ["$isPublished", 1, 0] } },
            totalViews: { $sum: { $ifNull: ["$views", 0] } },
          },
        },
      ]),
      Article.aggregate([
        {
          $lookup: {
            from: Category.collection.name,
            localField: "category",
            foreignField: "_id",
            as: "cat",
          },
        },
        { $unwind: { path: "$cat", preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: { $ifNull: ["$cat.name", "Без категории"] },
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
        { $limit: TOP },
      ]),
      byField(Article, "originalLanguage", "—"),
      Article.aggregate([
        {
          $lookup: {
            from: User.collection.name,
            localField: "authorId",
            foreignField: "_id",
            as: "author",
          },
        },
        { $unwind: { path: "$author", preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: { $ifNull: ["$author.country", NA] },
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
        { $limit: TOP },
      ]),
      Article.aggregate([
        {
          $lookup: {
            from: User.collection.name,
            localField: "authorId",
            foreignField: "_id",
            as: "author",
          },
        },
        { $unwind: { path: "$author", preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: Specialization.collection.name,
            localField: "author.specialization",
            foreignField: "_id",
            as: "spec",
          },
        },
        { $unwind: { path: "$spec", preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: { $ifNull: ["$spec.name", NA] },
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
        { $limit: TOP },
      ]),
      Article.aggregate([
        {
          $lookup: {
            from: User.collection.name,
            localField: "authorId",
            foreignField: "_id",
            as: "author",
          },
        },
        { $unwind: { path: "$author", preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: { $ifNull: ["$author.username", "—"] },
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),

      // ---------- Врачи ----------
      byField(ProfileDoctor, "verificationStatus", "none"),
      byField(ProfileDoctor, "country"),
      User.aggregate([
        { $match: { role: "doctor" } },
        {
          $lookup: {
            from: Specialization.collection.name,
            localField: "specialization",
            foreignField: "_id",
            as: "spec",
          },
        },
        { $unwind: { path: "$spec", preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: { $ifNull: ["$spec.name", NA] },
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
        { $limit: TOP },
      ]),

      // ---------- Пользователи ----------
      User.aggregate([
        { $group: { _id: "$role", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      User.aggregate([
        { $match: { createdAt: { $ne: null } } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      User.countDocuments(),
    ]);

    // Возрастные корзины → человекочитаемые лейблы.
    const ageLabels = {
      0: "до 18",
      18: "18–29",
      30: "30–45",
      46: "46–59",
      60: "60+",
      unknown: NA,
    };
    const patByAge = (patAge || []).map((b) => ({
      label: ageLabels[b._id] ?? String(b._id),
      count: b.count,
    }));

    const artAgg = artSummary?.[0] || { total: 0, published: 0, totalViews: 0 };

    return {
      patients: {
        totalCards: patientCards,
        registeredUsers: patientUsers,
        byAge: patByAge,
        byCountry: norm(patCountry),
        byGender: norm(patGender),
        byStatus: norm(patStatus),
        byDiagnosis: norm(patDiagnosis),
      },
      articles: {
        total: artAgg.total,
        published: artAgg.published,
        draft: artAgg.total - artAgg.published,
        totalViews: artAgg.totalViews,
        byCategory: norm(artByCategory),
        byLanguage: norm(artByLanguage, "—"),
        byAuthorCountry: norm(artByAuthorCountry),
        bySpecialization: norm(artBySpecialization),
        topAuthors: norm(artTopAuthors, "—"),
      },
      doctors: {
        byVerification: norm(docByVerification, "none"),
        byCountry: norm(docByCountry),
        bySpecialization: norm(docBySpecialization),
      },
      users: {
        total: usersTotal,
        byRole: norm(usersByRole),
        registrationsByMonth: norm(usersByMonth).slice(-12),
      },
      generatedAt: new Date(),
    };
}

// GET /admin/database/analytics — данные в JSON.
const adminDatabaseController = async (req, res) => {
  try {
    const data = await computeAnalytics();
    return res.status(200).json(data);
  } catch (error) {
    console.error("❌ adminDatabase analytics error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Не удалось собрать аналитику" });
  }
};

// Разбор параметра sections (?sections=patients,articles или "all").
function parseSections(raw) {
  const ALL = ["patients", "articles", "doctors", "users"];
  if (!raw || raw === "all") return ALL;
  const asked = String(raw)
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => ALL.includes(s));
  return asked.length ? asked : ALL;
}

// GET /admin/database/export/pdf?sections=... — скачивание PDF.
export async function exportAnalyticsPdf(req, res) {
  try {
    const sections = parseSections(req.query.sections);
    const data = await computeAnalytics();
    const pdf = await buildAnalyticsPdf(data, sections);
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="docpats-analytics-${stamp}.pdf"`,
    );
    return res.status(200).end(pdf);
  } catch (error) {
    console.error("❌ exportAnalyticsPdf error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Не удалось сформировать PDF" });
  }
}

// POST /admin/database/email { email, sections } — отправка PDF на почту.
export async function emailAnalyticsPdf(req, res) {
  try {
    const { email } = req.body || {};
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
      return res
        .status(400)
        .json({ success: false, message: "Укажите корректный email" });
    }
    const sections = parseSections(req.body?.sections);
    const data = await computeAnalytics();
    const pdf = await buildAnalyticsPdf(data, sections);
    const stamp = new Date().toISOString().slice(0, 10);

    await sendEmailWithAttachment(
      email,
      `DocPats — аналитика платформы (${stamp})`,
      "Во вложении PDF со сводной аналитикой платформы DocPats.\n\nЭто письмо сформировано автоматически из админпанели.",
      [
        {
          filename: `docpats-analytics-${stamp}.pdf`,
          content: pdf,
          contentType: "application/pdf",
        },
      ],
    );
    return res.status(200).json({ success: true, message: "Отчёт отправлен" });
  } catch (error) {
    console.error("❌ emailAnalyticsPdf error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Не удалось отправить отчёт" });
  }
}

export default adminDatabaseController;
