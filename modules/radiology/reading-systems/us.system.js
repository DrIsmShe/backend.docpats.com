// server/modules/radiology/reading-systems/us.system.js
//
// Система чтения УЗИ. Статичный кадр (или стоп-кадр петли) — тот же холст
// с зумом и измерением. Протокол — общий системный разбор органа.

import { defineReadingSystem } from "./base.js";

export default defineReadingSystem({
  modality: "us",
  title: "Ультразвуковое исследование",
  description:
    "УЗИ: оценка структуры и эхогенности, поиск очагов и свободной жидкости, заключение.",
  viewer: {
    multiSlice: false,
    tools: ["zoom", "pan", "measure", "roi"],
    windowPresets: [],
  },
  checklist: [
    { key: "structure", label: "Структура органа: контуры, размеры" },
    { key: "echogenicity", label: "Эхогенность паренхимы" },
    { key: "focal", label: "Очаговые образования" },
    { key: "fluid", label: "Свободная жидкость" },
    { key: "ducts", label: "Протоки / полостная система" },
    { key: "doppler", label: "Кровоток (допплер, если нужен)" },
  ],
  scoring: {
    weights: {
      detection: 0.4,
      classification: 0.2,
      checklist: 0.15,
      diagnosis: 0.2,
      aiImpression: 0.05,
    },
    matchRadius: 0.1,
    falseAlarmPenalty: 1,
    passThreshold: 0.7,
  },
});
