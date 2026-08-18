// server/modules/dictation/sinks/index.js
//
// Реестр приёмников — тот же приём, что в radiology/reading-systems и в
// diagnostics/core/services/registry.js: набор плагинов, доступ по ключу.
//
// Добавить модуль-получатель = добавить файл и одну строку сюда. Движок
// (модель, провайдеры, воркер, маршруты) при этом не меняется вовсе — ради
// этого разделение и сделано.

import myClinicSink from "./myClinic.sink.js";
import clinicSink from "./clinic.sink.js";

const SINKS = {
  [myClinicSink.key]: myClinicSink,
  [clinicSink.key]: clinicSink,
};

/** Приёмник по ключу или undefined, если такого нет. */
export function getSink(key) {
  return SINKS[key];
}

/** Есть ли приёмник с таким ключом. */
export function hasSink(key) {
  return Boolean(SINKS[key]);
}

/** Ключи доступных приёмников — для валидации входа и для интерфейса. */
export function listSinks() {
  return Object.keys(SINKS);
}
