// __tests__/medical-codes/codeTranslation.test.js
//
// Перевод названий кодов. Вызов модели замокан: тест проверяет ЛОГИКУ вокруг
// него — разбор ответа, отказ при рассинхроне, сохранение и то, что поиск
// после перевода начинает находить по переведённому названию.
//
// Самое важное здесь — проверка на сдвиг: если модель вернёт на один перевод
// меньше, названия разъедутся по кодам, и гастрит получит имя синусита. Такую
// пачку нужно отбрасывать целиком, а не записывать частично.

import { describe, it, expect, beforeEach, vi } from "vitest";

// Маленькая пачка — до импорта сервиса, он читает размер при загрузке. Иначе
// на любом разумном тестовом наборе пачка всегда одна, и поведение МЕЖДУ
// пачками (пропуск неудачной, счётчик сбоев подряд) проверять не на чем.
process.env.MEDICAL_CODES_TRANSLATION_BATCH = "2";

const createMock = vi.fn();

// Мокаем клиента Anthropic на уровне модуля-хелпера, который использует сервис.
vi.mock(
  "../../modules/education/education-ingest/extractors/claude.extractor.js",
  () => ({
    getClient: () => ({ messages: { create: createMock } }),
    isConfigured: () => true,
    describeApiError: (err) => ({ retryable: false, message: err?.message }),
  }),
);

const { default: MedicalCode, CODE_SYSTEMS, normalizeCode, buildSearchText } =
  await import("../../modules/medicalCodes/models/medicalCode.model.js");
const {
  translateBatch,
  translateCodes,
  countUntranslated,
  nextUntranslatedBatch,
} = await import("../../modules/medicalCodes/services/codeTranslation.service.js");
const { searchCodes, resetSearchStrategy } = await import(
  "../../modules/medicalCodes/services/codeSearch.service.js"
);

function reply(text) {
  return { stop_reason: "end_turn", content: [{ type: "text", text }] };
}

async function seed() {
  const rows = [
    { code: "A00.0", en: "Cholera due to Vibrio cholerae" },
    { code: "A00.9", en: "Cholera, unspecified" },
    { code: "J35.01", en: "Chronic tonsillitis" },
  ];

  await MedicalCode.insertMany(
    rows.map(({ code, en }) => {
      const doc = {
        system: CODE_SYSTEMS.ICD10CM,
        code,
        codeNormalized: normalizeCode(code),
        titles: { en, ru: "", az: "", tr: "", ar: "" },
        parentCode: code.split(".")[0],
        isBillable: true,
      };
      return { ...doc, searchText: buildSearchText(doc) };
    }),
  );
}

describe("перевод кодов", () => {
  beforeEach(async () => {
    createMock.mockReset();
    resetSearchStrategy();
    await seed();
  });

  it("сохраняет переводы и обновляет строку поиска", async () => {
    createMock.mockResolvedValue(
      reply('["Холера, вызванная холерным вибрионом","Холера неуточнённая"]'),
    );

    const batch = await nextUntranslatedBatch("ru", { limit: 2 });
    const count = await translateBatch(batch, "ru");

    expect(count).toBe(2);

    const doc = await MedicalCode.findOne({ code: "A00.9" }).lean();
    expect(doc.titles.ru).toBe("Холера неуточнённая");
    // Переведённое название обязано попасть в searchText, иначе запасной
    // поиск по обычному Mongo не найдёт код по-русски.
    expect(doc.searchText).toContain("Холера неуточнённая");
  });

  it("после перевода код находится по русскому названию", async () => {
    createMock.mockResolvedValue(reply('["Хронический тонзиллит"]'));

    const batch = await MedicalCode.find({ code: "J35.01" })
      .select("_id code titles")
      .lean();
    await translateBatch(batch, "ru");

    const { items } = await searchCodes({ query: "тонзиллит", locale: "ru" });
    expect(items.map((i) => i.code)).toContain("J35.01");
  });

  it("отбрасывает пачку целиком, если переводов пришло меньше", async () => {
    // Сдвиг на один элемент — самая опасная ошибка: названия разъедутся по
    // кодам молча.
    createMock.mockResolvedValue(reply('["Только один перевод"]'));

    const batch = await nextUntranslatedBatch("ru", { limit: 3 });
    await expect(translateBatch(batch, "ru")).rejects.toThrow(/вместо/);

    const untouched = await MedicalCode.findOne({ code: "A00.0" }).lean();
    expect(untouched.titles.ru).toBe("");
  });

  it("разбирает ответ, обёрнутый в markdown", async () => {
    createMock.mockResolvedValue(
      reply('```json\n["Холера А","Холера Б"]\n```'),
    );

    const batch = await nextUntranslatedBatch("ru", { limit: 2 });
    expect(await translateBatch(batch, "ru")).toBe(2);
  });

  it("отказ модели не записывает ничего", async () => {
    createMock.mockResolvedValue({ stop_reason: "refusal", content: [] });

    const batch = await nextUntranslatedBatch("ru", { limit: 2 });
    await expect(translateBatch(batch, "ru")).rejects.toThrow(/отказал/i);

    const doc = await MedicalCode.findOne({ code: "A00.0" }).lean();
    expect(doc.titles.ru).toBe("");
  });

  it("пустой перевод пропускается, английское название сохраняется", async () => {
    createMock.mockResolvedValue(reply('["","Холера неуточнённая"]'));

    const batch = await nextUntranslatedBatch("ru", { limit: 2 });
    const count = await translateBatch(batch, "ru");

    expect(count).toBe(1);
    const skipped = await MedicalCode.findOne({ code: "A00.0" }).lean();
    expect(skipped.titles.ru).toBe("");
    expect(skipped.titles.en).toBeTruthy();
  });

  it("не переводит на английский — это язык оригинала", async () => {
    const batch = await nextUntranslatedBatch("ru", { limit: 1 });
    await expect(translateBatch(batch, "en")).rejects.toThrow(/язык/i);
  });

  it("считает непереведённые коды по языкам отдельно", async () => {
    createMock.mockResolvedValue(reply('["Хронический тонзиллит"]'));

    const batch = await MedicalCode.find({ code: "J35.01" })
      .select("_id code titles")
      .lean();
    await translateBatch(batch, "ru");

    expect(await countUntranslated("ru")).toBe(2);
    expect(await countUntranslated("az")).toBe(3);
  });
});

// ── Параллельный перевод на несколько языков ──────────────────────────────────
//
// Языки переводятся отдельными процессами одновременно — иначе весь справочник
// на четыре языка занимает больше суток. Здесь проверяется, что они не портят
// работу друг друга.

describe("несколько языков одновременно", () => {
  beforeEach(async () => {
    resetSearchStrategy();
    await seed();
  });

  it("не теряет чужой перевод из строки поиска", async () => {
    // Оба «процесса» читают документ ДО того, как записал другой — ровно та
    // ситуация, в которой прежняя сборка searchText из прочитанной копии
    // молча выбрасывала название, добавленное соседом.
    const forRu = await nextUntranslatedBatch("ru", { limit: 3 });
    const forTr = await nextUntranslatedBatch("tr", { limit: 3 });

    createMock.mockResolvedValueOnce(
      reply('["Холера, вызванная Vibrio cholerae","Холера неуточнённая","Хронический тонзиллит"]'),
    );
    await translateBatch(forRu, "ru");

    createMock.mockResolvedValueOnce(
      reply('["Vibrio cholerae kaynaklı kolera","Kolera, tanımlanmamış","Kronik tonsillit"]'),
    );
    await translateBatch(forTr, "tr");

    const doc = await MedicalCode.findOne({ code: "J35.01" }).lean();

    expect(doc.titles.ru).toBe("Хронический тонзиллит");
    expect(doc.titles.tr).toBe("Kronik tonsillit");
    // Главное: в строке поиска остались ОБА названия.
    expect(doc.searchText).toContain("Хронический тонзиллит");
    expect(doc.searchText).toContain("Kronik tonsillit");
    expect(doc.searchText).toContain("Chronic tonsillitis");
    expect(doc.searchText).toContain("J3501");
  });

  it("после этого код находится на каждом из языков", async () => {
    const forRu = await nextUntranslatedBatch("ru", { limit: 3 });
    const forTr = await nextUntranslatedBatch("tr", { limit: 3 });

    createMock.mockResolvedValueOnce(
      reply('["Холера, вызванная Vibrio cholerae","Холера неуточнённая","Хронический тонзиллит"]'),
    );
    await translateBatch(forRu, "ru");
    createMock.mockResolvedValueOnce(
      reply('["Vibrio cholerae kaynaklı kolera","Kolera, tanımlanmamış","Kronik tonsillit"]'),
    );
    await translateBatch(forTr, "tr");

    const ru = await searchCodes({ query: "тонзиллит", locale: "ru" });
    const tr = await searchCodes({ query: "tonsillit", locale: "tr" });

    expect(ru.items.map((i) => i.code)).toContain("J35.01");
    expect(tr.items.map((i) => i.code)).toContain("J35.01");
  });

  it("строка поиска не копит мусор при повторной записи", async () => {
    const batch = await nextUntranslatedBatch("ru", { limit: 3 });
    createMock.mockResolvedValueOnce(
      reply('["Холера, вызванная Vibrio cholerae","Холера неуточнённая","Хронический тонзиллит"]'),
    );
    await translateBatch(batch, "ru");

    // Перевод стёрли и перевели заново — так бывает при смене промпта.
    await MedicalCode.updateOne({ code: "J35.01" }, { $set: { "titles.ru": "" } });
    const again = await nextUntranslatedBatch("ru", { limit: 1 });
    createMock.mockResolvedValueOnce(reply('["Тонзиллит хронический"]'));
    await translateBatch(again, "ru");

    const doc = await MedicalCode.findOne({ code: "J35.01" }).lean();
    // Строка пересобирается целиком, а не дописывается: старого названия в ней
    // остаться не должно, иначе она разрастётся за много прогонов.
    expect(doc.searchText).toContain("Тонзиллит хронический");
    expect(doc.searchText).not.toContain("Хронический тонзиллит");
  });
});

// ── Устойчивость длинного прогона ────────────────────────────────────────────
//
// Перевод справочника на один язык — тысячи запросов и часы работы. За это
// время разовый сбой (перегрузка сервиса, обрыв, упор в лимит) практически
// неизбежен. Раньше прогон прекращался после ПЕРВОЙ же неудачной пачки: реальный
// перевод оборвался ровно так, и многочасовая работа не доводилась до конца.
//
// Пачка здесь маленькая (MEDICAL_CODES_TRANSLATION_BATCH=2, задана до импорта
// сервиса) — иначе на любом разумном наборе кодов пачка всегда одна, и проверять
// поведение между пачками не на чем.

describe("длинный прогон переживает сбои", () => {
  const noSleep = () => Promise.resolve();
  const ok = () => reply('["Перевод A","Перевод B"]');

  // Восемь кодов = четыре пачки по два. Хватает, чтобы прогон мог и
  // переступить через неудачную пачку, и упереться в три подряд.
  async function seedMany() {
    await MedicalCode.deleteMany({});
    await MedicalCode.insertMany(
      Array.from({ length: 8 }, (_, i) => {
        const code = `B${String(i).padStart(2, "0")}.0`;
        const doc = {
          system: CODE_SYSTEMS.ICD10CM,
          code,
          codeNormalized: normalizeCode(code),
          titles: { en: `Disease ${i}`, ru: "", az: "", tr: "", ar: "" },
          parentCode: `B${String(i).padStart(2, "0")}`,
          isBillable: true,
        };
        return { ...doc, searchText: buildSearchText(doc) };
      }),
    );
  }

  beforeEach(async () => {
    createMock.mockReset();
    resetSearchStrategy();
    await seedMany();
  });

  it("повторяет пачку после разового сбоя и идёт дальше", async () => {
    createMock
      .mockRejectedValueOnce(new Error("529 Overloaded"))
      .mockResolvedValue(ok());

    const res = await translateCodes("ru", { max: 2, sleep: noSleep });

    expect(res.translated).toBe(2);
    // Разовый сбой не должен оставлять следа в итоге прогона.
    expect(res.failedBatches).toBe(0);
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("переступает через пачку, которая не далась и после повторов", async () => {
    // Первая пачка не даётся все три попытки, дальше всё работает.
    createMock
      .mockRejectedValueOnce(new Error("сбой"))
      .mockRejectedValueOnce(new Error("сбой"))
      .mockRejectedValueOnce(new Error("сбой"))
      .mockResolvedValue(ok());

    const res = await translateCodes("ru", { max: 4, sleep: noSleep });

    // Прогон не встал на первой неудаче и перевёл следующие пачки.
    expect(res.translated).toBe(4);
    // Пропущенная пачка осталась непереведённой — её возьмёт следующий запуск,
    // потому что выборка идёт по «ещё не переведённым».
    const stillEmpty = await countUntranslated("ru");
    expect(stillEmpty).toBe(4);
  });

  it("останавливается, когда не даётся ничего — так кончились кредиты", async () => {
    // Реальный обрыв выглядел именно так: 400 credit balance is too low.
    createMock.mockRejectedValue(new Error("credit balance is too low"));

    await expect(
      translateCodes("ru", { max: 500, sleep: noSleep }),
    ).rejects.toThrow(/Три пачки подряд/);

    // Три пачки по три попытки — и стоп. Дальше запросы жглись бы впустую.
    expect(createMock).toHaveBeenCalledTimes(9);
  });

  it("удачная пачка сбрасывает счётчик подряд идущих сбоев", async () => {
    // Сбой — успех — сбой: три неудачные попытки дважды, но НЕ подряд.
    // Без сброса счётчика редкие разовые ошибки за долгий прогон накопились
    // бы и остановили работу на ровном месте.
    let call = 0;
    createMock.mockImplementation(async () => {
      call++;
      if (call <= 3 || (call >= 5 && call <= 7)) throw new Error("сбой");
      return ok();
    });

    const res = await translateCodes("ru", { max: 4, sleep: noSleep });

    expect(res.translated).toBe(4);
    expect(res.failedBatches).toBe(0);
  });
});

// ── Потолок трат ─────────────────────────────────────────────────────────────
//
// Ключ Anthropic в проекте ОДИН на всё: этим же балансом живут надиктовка,
// диагностика, ИИ-консультация, ночная генерация кейсов радиологии и движок
// новостей. Массовый перевод идёт часами без присмотра, поэтому у него должен
// быть предел: иначе деньги кончатся ночью, а обнаружится это утром отказом
// у врача, а не в выводе скрипта.

describe("остановка по внешнему условию", () => {
  const noSleep = () => Promise.resolve();

  beforeEach(async () => {
    createMock.mockReset();
    resetSearchStrategy();
    await seed();
  });

  it("не делает ни одного запроса, если предел уже достигнут", async () => {
    createMock.mockResolvedValue(reply('["Перевод A","Перевод B"]'));

    const res = await translateCodes("ru", {
      max: 100,
      sleep: noSleep,
      shouldStop: () => "budget",
    });

    expect(res.translated).toBe(0);
    expect(res.stoppedBy).toBe("budget");
    // Главное: проверка ДО запроса, а не после — иначе потолок сообщал бы о
    // перерасходе вместо того, чтобы его не допустить.
    expect(createMock).not.toHaveBeenCalled();
  });

  it("останавливается на границе, сохраняя уже переведённое", async () => {
    createMock.mockResolvedValue(reply('["Перевод A","Перевод B"]'));

    // Пускаем ровно одну пачку: условие срабатывает, когда что-то переведено.
    const res = await translateCodes("ru", {
      max: 100,
      sleep: noSleep,
      shouldStop: ({ translated }) => (translated > 0 ? "budget" : false),
    });

    expect(res.translated).toBe(2);
    expect(res.stoppedBy).toBe("budget");
    // Переведённое записано в базу — остановка не откатывает работу.
    expect(await countUntranslated("ru")).toBe(1);
  });

  it("расход виден условию остановки — по нему и считается потолок", async () => {
    // Ответ с usage: именно оттуда берутся токены, по которым скрипт считает
    // потраченные доллары. Без него потолок молча никогда бы не сработал.
    createMock.mockResolvedValue({
      ...reply('["Перевод A","Перевод B"]'),
      usage: { input_tokens: 800, output_tokens: 600 },
    });
    const seen = [];

    await translateCodes("ru", {
      max: 100,
      sleep: noSleep,
      shouldStop: ({ usage }) => {
        seen.push(usage.outputTokens);
        return seen.length > 2;
      },
    });

    // На первой проверке расхода ещё нет, дальше он растёт.
    expect(seen[0]).toBe(0);
    expect(seen[seen.length - 1]).toBeGreaterThan(0);
  });

  it("без условия работает как раньше", async () => {
    createMock.mockResolvedValue(reply('["Перевод A","Перевод B"]'));

    const res = await translateCodes("ru", { max: 2, sleep: noSleep });

    expect(res.translated).toBe(2);
    expect(res.stoppedBy).toBeNull();
  });
});
