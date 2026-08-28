// __tests__/surgery/simulationRoutes.test.js
//
// Каждый обработчик, упомянутый в маршрутах, обязан существовать в
// контроллере.
//
// Проверка появилась после падения прода: в simulation.routes.js добавили
// router.get("/prompts", ctrl.getPromptCatalog), а сама функция в контроллер
// не попала — правка применилась не полностью и никто этого не заметил.
// Express на такое отвечает «Route.get() requires a callback function but got
// a [object Undefined]» на СТАРТЕ приложения: сервер не поднимается вообще,
// и вместе с симуляцией отваливается авторизация, приёмы, чат — всё.
//
// Разбор делается по тексту файлов, а не импортом: контроллер тянет за собой
// сервис, тот — очередь BullMQ, а она лезет в Redis. Для проверки «есть ли
// такая функция» поднимать инфраструктуру незачем.

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE_DIR = path.join(__dirname, "../../modules/surgery");

const read = (file) => fs.readFileSync(path.join(MODULE_DIR, file), "utf8");

/** Имена, которые маршруты ждут от контроллера: ctrl.<имя>. */
function handlersUsedIn(routesSource) {
  return [...routesSource.matchAll(/ctrl\.([A-Za-z0-9_]+)/g)].map((m) => m[1]);
}

/** Имена, которые контроллер действительно экспортирует. */
function handlersExportedBy(controllerSource) {
  return [
    ...controllerSource.matchAll(
      /export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/g,
    ),
  ].map((m) => m[1]);
}

describe("маршруты симуляции", () => {
  const routes = read("simulation.routes.js");
  const controller = read("simulation.controller.js");

  it("каждый обработчик из маршрутов есть в контроллере", () => {
    const used = handlersUsedIn(routes);
    const exported = handlersExportedBy(controller);

    expect(used.length).toBeGreaterThan(0);
    const missing = used.filter((name) => !exported.includes(name));
    expect(missing).toEqual([]);
  });

  it("каталог зон отдаётся отдельным маршрутом", () => {
    // Порядок важен: /prompts должен стоять ДО /prompts/:procedure, иначе
    // параметрический маршрут перехватит запрос и вернёт пресеты процедуры
    // с именем "prompts".
    const catalogAt = routes.indexOf('router.get("/prompts"');
    const byProcedureAt = routes.indexOf('router.get("/prompts/:procedure"');

    expect(catalogAt).toBeGreaterThan(-1);
    expect(byProcedureAt).toBeGreaterThan(-1);
    expect(catalogAt).toBeLessThan(byProcedureAt);
  });

  it("контроллер зовёт из сервиса только то, что тот отдаёт", () => {
    const service = read("simulation.service.js");
    // Именно ВЫЗОВЫ: без скобок регулярка ловит и "simulation.service.js"
    // из строки импорта, и тест начинает искать в сервисе функцию "js".
    const used = [
      ...controller.matchAll(/service\.([A-Za-z0-9_]+)\s*\(/g),
    ].map((m) => m[1]);
    const exported = handlersExportedBy(service);

    const missing = [...new Set(used)].filter((n) => !exported.includes(n));
    expect(missing).toEqual([]);
  });
});
