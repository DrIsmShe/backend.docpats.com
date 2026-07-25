// server/modules/radiology/analytics/analytics.service.js
//
// Аналитика «Диагностической арены» для авторов: кто играет, какие кейсы
// трудные и какие находки чаще всего пропускают. Замыкает цикл «контент →
// игроки → выводы»: по этим цифрам автор понимает, что переписать.
//
// Ничего не пересчитываем на лету по всей истории без нужды: агрегаты по
// кейсам уже лежат в stats (attempts/avgScore), а item-analysis по находкам
// считаем одной aggregate-я по matches попыток.

import RadiologyPlayer from "../game/radiologyPlayer.model.js";
import RadiologyAttempt from "../radiology-attempts/models/radiologyAttempt.model.js";
import RadiologyCase from "../radiology-cases/models/radiologyCase.model.js";
import LabAttempt from "../labs-station/models/labAttempt.model.js";
import LabCase from "../labs-station/models/labCase.model.js";
import VpAttempt from "../virtual-patient/models/vpAttempt.model.js";
import VpCase from "../virtual-patient/models/vpCase.model.js";
import { findingTerm } from "../lexicon/lexicon.js";

export async function getOverview() {
  const [
    players,
    radAttempts,
    labAttempts,
    vpAttempts,
    radCases,
    labCases,
    vpCases,
  ] = await Promise.all([
    RadiologyPlayer.countDocuments({}),
    RadiologyAttempt.countDocuments({ status: "submitted" }),
    LabAttempt.countDocuments({ status: "submitted" }),
    VpAttempt.countDocuments({ status: "submitted" }),
    RadiologyCase.countDocuments({ status: "published" }),
    LabCase.countDocuments({ status: "published" }),
    VpCase.countDocuments({ status: "published" }),
  ]);

  return {
    players,
    totalAttempts: radAttempts + labAttempts + vpAttempts,
    stations: {
      radiology: { cases: radCases, attempts: radAttempts },
      labs: { cases: labCases, attempts: labAttempts },
      vp: { cases: vpCases, attempts: vpAttempts },
    },
  };
}

// Сводка по кейсам всех станций: попытки и средний балл. Архивные не
// показываем. Средний балл 0..1.
export async function getCasesReport() {
  const [rad, lab, vp] = await Promise.all([
    RadiologyCase.find({ status: { $ne: "archived" } })
      .select("title status stats modality")
      .lean(),
    LabCase.find({ status: { $ne: "archived" } })
      .select("title status stats")
      .lean(),
    VpCase.find({ status: { $ne: "archived" } })
      .select("title status stats")
      .lean(),
  ]);

  const map = (docs, station) =>
    docs.map((d) => ({
      id: String(d._id),
      station,
      title: d.title,
      status: d.status,
      attempts: d.stats?.attempts ?? 0,
      avgScore: d.stats?.avgScore ?? 0,
    }));

  return [
    ...map(rad, "Снимки"),
    ...map(lab, "Анализы"),
    ...map(vp, "Виртуальный пациент"),
  ];
}

// Item-analysis станции снимков: какие находки чаще всего пропускают.
// Считаем по matches сданных попыток. Возвращаем находки с достаточной
// статистикой (встречались >= MIN раз), отсортированные по доле пропусков.
const MIN_OCCURRENCES = 3;

export async function getMissedFindings() {
  const rows = await RadiologyAttempt.aggregate([
    { $match: { status: "submitted" } },
    { $unwind: "$matches" },
    {
      $group: {
        _id: "$matches.label",
        total: { $sum: 1 },
        missed: {
          $sum: { $cond: [{ $eq: ["$matches.outcome", "missed"] }, 1, 0] },
        },
      },
    },
  ]);

  return rows
    .filter((r) => r.total >= MIN_OCCURRENCES)
    .map((r) => ({
      label: r._id,
      name: findingTerm(r._id)?.label ?? r._id,
      total: r.total,
      missed: r.missed,
      missRate: r.total > 0 ? r.missed / r.total : 0,
    }))
    .sort((a, b) => b.missRate - a.missRate || b.total - a.total)
    .slice(0, 20);
}
