// Прайс и квоты должны совпадать.
//
// ЗАЧЕМ. На странице тарифов платным планам обещали «создание фильмов без
// лимита». Это было верно ровно до дня, когда у тарифов появились квоты:
// у doctor_basic час сборки, у doctor_pro пять. Обещание, которого код не
// выполняет, — худший вид ошибки в прайсе: человек платит за одно, а
// упирается в другое, и узнаёт об этом уже после оплаты.
//
// Тест читает КАРТОЧКИ ПРАЙСА на клиенте и сверяет числа с конфигом
// сервера. Источник правды — сервер; страница лишь показывает.
//
// ПОЧЕМУ ЧЕРЕЗ ЧТЕНИЕ ФАЙЛА. Клиент и сервер — разные приложения в разных
// репозиториях, общего модуля у них нет. Разбор исходника хрупок, но
// молчаливое расхождение прайса с реальностью хуже: его замечает
// покупатель, а не разработчик.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { PLAN_LIMITS } from "../../common/config/aiPlanLimits.js";

const ПРАЙС = path.resolve(
  process.cwd(),
  "..",
  "client",
  "src",
  "pages",
  "PricingPage.jsx",
);

const естьПрайс = fs.existsSync(ПРАЙС);

describe.runIf(естьПрайс)("прайс совпадает с квотами", () => {
  const текст = естьПрайс ? fs.readFileSync(ПРАЙС, "utf8") : "";

  /** Разбирает карточки: тариф → обещанные минуты и гигабайты. */
  function обещания() {
    const куски = текст.split(/key: "/).slice(1);
    const итог = {};

    for (const кусок of куски) {
      const тариф = кусок.slice(0, кусок.indexOf('"'));
      const мин = кусок.match(/features\.videraMinutes",\s*vars:\s*\{\s*count:\s*(\d+)/);
      const гб = кусок.match(/features\.videraStorage",\s*vars:\s*\{\s*count:\s*(\d+)/);
      if (мин || гб) {
        итог[тариф] = {
          minutes: мин ? Number(мин[1]) : null,
          storage: гб ? Number(гб[1]) : null,
        };
      }
    }
    return итог;
  }

  const карточки = обещания();

  it("карточки с видео вообще нашлись", () => {
    // Защита от бессмысленно зелёного теста, если разметка изменится.
    expect(Object.keys(карточки).length).toBeGreaterThan(4);
  });

  it("нигде не обещан безлимит на сборку", () => {
    // Старое обещание «без лимита» должно исчезнуть вместе с безлимитом.
    expect(текст).not.toMatch(/videraFilmsUnlimited/);
  });

  for (const [тариф, обещано] of Object.entries(карточки)) {
    it(`${тариф}: минуты совпадают с конфигом`, () => {
      const лимит = PLAN_LIMITS[тариф]?.videraRenderMinutes;
      expect(лимит, `тарифа ${тариф} нет в PLAN_LIMITS`).toBeTypeOf("number");
      expect(обещано.minutes).toBe(лимит);
    });

    it(`${тариф}: гигабайты совпадают с конфигом`, () => {
      const лимит = PLAN_LIMITS[тариф]?.videraStorageGb;
      expect(лимит, `тарифа ${тариф} нет в PLAN_LIMITS`).toBeTypeOf("number");
      expect(обещано.storage).toBe(лимит);
    });
  }
});
