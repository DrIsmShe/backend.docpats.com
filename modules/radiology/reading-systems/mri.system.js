// server/modules/radiology/reading-systems/mri.system.js
//
// Система чтения МРТ. Тот же холст; протокол — разбор по последовательностям
// и поиск патологического сигнала/масс-эффекта.

import { defineReadingSystem } from "./base.js";

export default defineReadingSystem({
  modality: "mri",
  title: "Магнитно-резонансная томография",
  description:
    "МРТ: оценка по последовательностям, поиск очагов и патологического сигнала, заключение.",
  viewer: {
    multiSlice: true,
    tools: ["zoom", "pan", "measure", "roi"],
    windowPresets: [],
  },
  checklist: [
    { key: "sequences", label: "Оценка по последовательностям (T1/T2/DWI/FLAIR)" },
    { key: "symmetry", label: "Симметрия структур" },
    { key: "focal", label: "Очаговые изменения" },
    { key: "signal", label: "Патологический сигнал / накопление контраста" },
    { key: "mass_effect", label: "Отёк и масс-эффект" },
    { key: "vessels", label: "Сосудистые структуры" },
  ],
  scoring: {
    weights: {
      detection: 0.4,
      classification: 0.2,
      checklist: 0.15,
      diagnosis: 0.2,
      aiImpression: 0.05,
    },
    matchRadius: 0.09,
    falseAlarmPenalty: 1,
    passThreshold: 0.7,
  },
});
