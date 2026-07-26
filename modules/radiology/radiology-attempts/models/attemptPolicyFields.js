// server/modules/radiology/radiology-attempts/models/attemptPolicyFields.js
//
// Поля попытки, одинаковые для всех трёх станций арены: режим, зачётность,
// лимит времени, сигналы добросовестности. Раскладываются в схему спредом.
//
// Отдельный файл, а не копия в каждой модели: правила зачёта живут в
// attemptPolicy.js, и хранилище должно расходиться с ними в одном месте, а
// не в трёх. Значения по умолчанию описывают старую попытку, заведённую до
// этих правил: тренировочная, не в зачёт, без лимита.

import mongoose from "mongoose";
import { ATTEMPT_MODES } from "../../constants.js";
import { COUNTED_REASONS, TRAINING_MODE } from "../services/attemptPolicy.js";

const { Schema } = mongoose;

export function attemptPolicyFields() {
  return {
    // learn — тренировка (не в зачёт), exam — зачёт.
    mode: { type: String, enum: ATTEMPT_MODES, default: TRAINING_MODE },
    // Порядковый номер попытки по этому кейсу у этого врача (для разбора).
    attemptNo: { type: Number, default: 1 },
    // Идёт ли попытка в XP, статистику кейса и очередь повторения.
    counted: { type: Boolean, default: false, index: true },
    countedReason: { type: String, enum: COUNTED_REASONS, default: "training" },
    // Первая зачётная по кейсу: только она формирует средний балл кейса и
    // счётчик уникальных кейсов у врача.
    isFirstCounted: { type: Boolean, default: false },

    // Лимит времени и дедлайн, посчитанный от начала попытки на сервере.
    // Клиентский таймер обходится, серверный дедлайн — нет.
    timeLimitSec: { type: Number, default: null },
    deadlineAt: { type: Date, default: null },
    durationMs: { type: Number, default: null },
    // Сдача пришла после дедлайна. Балл сохраняется как есть, но зачётность
    // снимается — иначе лимит времени был бы декоративным.
    lateSubmit: { type: Boolean, default: false },

    // Сигналы добросовестности (integrity.service.js). Mixed: набор
    // сигналов будет меняться, а миграций схемы это стоить не должно.
    integrity: { type: Schema.Types.Mixed, default: null },
  };
}
