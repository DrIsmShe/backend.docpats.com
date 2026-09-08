// Схема публичной выдачи должна пропускать всё, что читает сервис.
//
// ЗАЧЕМ ЭТИ ТЕСТЫ ПОЯВИЛИСЬ. Сервис витрины с первого дня читал
// query.categoryId и query.q, но в схеме этих полей не было, а zod молча
// выбрасывает неизвестные. Отказа нет, ошибки в журнале нет — выдача
// просто всегда возвращала весь каталог. Человек выбирал раздел и видел
// те же ролики: поломка, которую не показывает ни один код ответа.
//
// Поэтому проверяем не «валидна ли строка», а СХОДЯТСЯ ЛИ ДВЕ СТОРОНЫ:
// то, что схема пропускает, и то, что сервис использует.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { publicListQuerySchema } from "../../modules/video/validators/video.schemas.js";

describe("схема запроса витрины", () => {
  it("пропускает раздел и поиск", () => {
    const итог = publicListQuerySchema.parse({
      categoryId: "a".repeat(24),
      q: "мрт",
    });
    expect(итог.categoryId).toBe("a".repeat(24));
    expect(итог.q).toBe("мрт");
  });

  it("пропускает ленту подписок, вид, язык и предел", () => {
    const итог = publicListQuerySchema.parse({
      feed: "subscriptions",
      kind: "explainer",
      lang: "ru",
      limit: "10",
    });
    expect(итог.feed).toBe("subscriptions");
    expect(итог.kind).toBe("explainer");
    expect(итог.lang).toBe("ru");
    // limit приходит строкой из адреса и должен стать числом.
    expect(итог.limit).toBe(10);
  });

  it("КАЖДОЕ поле, которое читает сервис, есть в схеме", () => {
    // Главная проверка файла. Читаем исходник сервиса и собираем все
    // обращения к query.<поле>; каждое обязано пройти через схему, иначе
    // оно не доедет и фильтр окажется декоративным.
    const источник = fs.readFileSync(
      path.join(process.cwd(), "modules/video/services/video.service.js"),
      "utf8",
    );

    const тело = источник.slice(
      источник.indexOf("export async function listPublicVideos"),
      источник.indexOf("export async function", источник.indexOf("listPublicVideos") + 40),
    );

    const поля = [...new Set([...тело.matchAll(/query\.(\w+)/g)].map((м) => м[1]))];
    expect(поля.length).toBeGreaterThan(0);

    const пропущено = поля.filter((поле) => {
      const итог = publicListQuerySchema.safeParse({ [поле]: "x".repeat(24) });
      // Поле «дошло», если схема его сохранила ИЛИ отвергла значение как
      // неподходящее по типу (значит поле она знает).
      return itНеЗнает(итог, поле);
    });

    expect(пропущено).toEqual([]);
  });
});

/** Знает ли схема о поле: сохранила его либо отвергла именно его значение. */
function itНеЗнает(итог, поле) {
  if (итог.success) return !(поле in итог.data);
  return !итог.error.issues.some((i) => i.path[0] === поле);
}
