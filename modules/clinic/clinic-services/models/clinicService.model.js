// server/modules/clinic/clinic-services/models/clinicService.model.js
//
// ВИТРИНА 2.0 (V4.2) — услуга клиники (прайс-позиция для блока bento/услуг).
//
// Паттерн полностью повторяет ClinicDepartment:
//   - clinicId объявлен ВРУЧНУЮ (ref Clinic), tenant-плагина НЕТ → публичный
//     сервис фильтрует clinicId явно (как departments).
//   - status active/archived, isSystem — единый стиль с departments.
//   - индексы объявлены здесь один раз (избегаем duplicate-index warnings).
//   - export const + export default (прямой model(), как в departments —
//     НЕ mongoose.models.X || ... ; этот bounded-context так и пишет).
//
// Привязка к отделению — ОПЦИОНАЛЬНАЯ (плоский список + departmentId). Услуга
// без отдела допустима (departmentId:null). Это даёт гибкость: прайс можно
// вести и плоско, и сгруппированным по отделениям — решает фронт.

import mongoose from "mongoose";

const { Schema, model, Types } = mongoose;

// Тип цены. Стабильные snake_case ключи — лейблы из i18n
// (services.priceType.<key>). DO NOT rename/remove; append only.
//   fixed       — фиксированная цена (price обязателен по смыслу)
//   from        — «от N» (price = нижняя граница)
//   range       — диапазон (price..priceMax)
//   on_request   — «по запросу» (price игнорируется)
//   free        — бесплатно
export const SERVICE_PRICE_TYPES = [
  "fixed",
  "from",
  "range",
  "on_request",
  "free",
];

const clinicServiceSchema = new Schema(
  {
    // ── Tenant ──────────────────────────────────────────────
    clinicId: {
      type: Types.ObjectId,
      ref: "Clinic",
      required: true,
    },

    // Optional binding to a specific branch (как у departments).
    // null = услуга на уровне клиники, во всех филиалах.
    branchId: {
      type: Types.ObjectId,
      ref: "ClinicBranch",
      default: null,
    },

    // Optional binding to a department. null = услуга вне отделения.
    // НЕ required — поддерживаем плоский прайс.
    departmentId: {
      type: Types.ObjectId,
      ref: "ClinicDepartment",
      default: null,
    },

    // ── Identity ────────────────────────────────────────────
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },

    // Короткий человекочитаемый код (опц., уникален в рамках клиники).
    code: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 32,
      default: null,
    },

    description: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: "",
    },

    // ── Pricing ─────────────────────────────────────────────
    priceType: {
      type: String,
      enum: SERVICE_PRICE_TYPES,
      default: "fixed",
    },

    // Цена (или нижняя граница для from/range). Не PHI, открытая.
    // null допустим (on_request/free). Неотрицательная.
    price: {
      type: Number,
      default: null,
      min: 0,
    },

    // Верхняя граница для priceType === "range".
    priceMax: {
      type: Number,
      default: null,
      min: 0,
    },

    // Валюта ISO-4217. Пусто → фронт берёт clinic.defaultCurrency.
    currency: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 3,
      default: null,
    },

    // Длительность услуги в минутах (опц., для расписания/инфо).
    durationMinutes: {
      type: Number,
      default: null,
      min: 0,
    },

    // ── Ordering / flags ────────────────────────────────────
    order: {
      type: Number,
      default: 0,
    },

    isSystem: {
      type: Boolean,
      default: false,
    },

    status: {
      type: String,
      enum: ["active", "archived"],
      default: "active",
    },
  },
  { timestamps: true },
);

// ── Indexes (объявлены один раз; избегаем duplicate-index warnings) ──
clinicServiceSchema.index({ clinicId: 1, status: 1 });
clinicServiceSchema.index({ clinicId: 1, departmentId: 1, status: 1 });
clinicServiceSchema.index({ clinicId: 1, branchId: 1 });
clinicServiceSchema.index({ clinicId: 1, order: 1 });

// Code уникален в рамках клиники, но только когда code задан.
clinicServiceSchema.index(
  { clinicId: 1, code: 1 },
  {
    unique: true,
    partialFilterExpression: { code: { $type: "string" } },
  },
);

export const ClinicService = model("ClinicService", clinicServiceSchema);

export default ClinicService;
