// Единое место, где решается, какой моделью работает платформа.
//
// Проверяем то, ради чего мостик и заводился: провайдер меняется настройкой,
// а не правкой кода; части проекта могут жить на разных провайдерах; а
// назначения, которых у Anthropic нет вовсе (распознавание речи, картинки),
// нельзя туда переключить даже намеренно — иначе они молча перестанут
// работать, и виноватым будет выглядеть код, а не выбор в админке.

import { describe, it, expect, beforeEach } from "vitest";

import AiSettings from "../../common/ai/aiSettings.model.js";
import {
  настройкиИИ,
  провайдерДля,
  сохранитьНастройкиИИ,
  сброситьКэшИИ,
  МОДЕЛИ_ПО_УМОЛЧАНИЮ,
} from "../../common/ai/provider.js";

beforeEach(() => {
  сброситьКэшИИ();
  delete process.env.AI_PROVIDER;
  delete process.env.TRANSLATION_MODEL;
});

describe("выбор модели", () => {
  it("на пустой базе платформа работает, а не встаёт", async () => {
    // Настройка может не существовать: до первого захода в админку её и
    // нет. Отсутствие записи означает «по умолчанию», а не «модели нет».
    const итог = await провайдерДля("translation");
    expect(итог.provider).toBe("anthropic");
    expect(итог.model).toBe(МОДЕЛИ_ПО_УМОЛЧАНИЮ.anthropic.translation);
  });

  it("окружение задаёт значение по умолчанию", async () => {
    process.env.AI_PROVIDER = "openai";
    сброситьКэшИИ();

    expect((await провайдерДля("summary")).provider).toBe("openai");
  });

  it("настройка из админки старше окружения", async () => {
    process.env.AI_PROVIDER = "openai";
    await сохранитьНастройкиИИ({ provider: "anthropic" });

    expect((await провайдерДля("summary")).provider).toBe("anthropic");
  });

  it("части проекта живут на разных провайдерах", async () => {
    // Ради этого мостик и задуман: перевод дешёвой моделью одного
    // провайдера, разборы — сильной моделью другого.
    await сохранитьНастройкиИИ({
      provider: "anthropic",
      tasks: { translation: { provider: "openai", model: "gpt-4o-mini" } },
    });

    expect((await провайдерДля("translation")).provider).toBe("openai");
    expect((await провайдерДля("translation")).model).toBe("gpt-4o-mini");
    expect((await провайдерДля("consultation")).provider).toBe("anthropic");
  });

  it("пустая модель означает «по умолчанию провайдера», а не пустоту", async () => {
    // Держать конкретное имя обязательным значило бы ломать платформу
    // каждый раз, когда модель снимают с обслуживания.
    await сохранитьНастройкиИИ({
      tasks: { translation: { provider: "anthropic", model: "" } },
    });

    expect((await провайдерДля("translation")).model).toBe(
      МОДЕЛИ_ПО_УМОЛЧАНИЮ.anthropic.translation,
    );
  });

  it("распознавание речи нельзя увести к Anthropic — такого API нет", async () => {
    await expect(
      сохранитьНастройкиИИ({ tasks: { speech: { provider: "anthropic" } } }),
    ).rejects.toThrow(/не выполняется/i);
  });

  it("речь и картинки остаются на OpenAI даже при общем переключении", async () => {
    await сохранитьНастройкиИИ({ provider: "anthropic" });

    expect((await провайдерДля("speech")).provider).toBe("openai");
    expect((await провайдерДля("image")).provider).toBe("openai");
    // И интерфейс должен знать, что выбора здесь нет.
    expect((await провайдерДля("speech")).fixed).toBe(true);
  });

  it("правка одного назначения не сбрасывает соседнее", async () => {
    await сохранитьНастройкиИИ({
      tasks: { translation: { provider: "openai", model: "gpt-4o-mini" } },
    });
    await сохранитьНастройкиИИ({
      tasks: { chat: { provider: "anthropic", model: "" } },
    });

    expect((await провайдерДля("translation")).model).toBe("gpt-4o-mini");
    expect((await провайдерДля("chat")).provider).toBe("anthropic");
  });

  it("неизвестный провайдер не сохраняется", async () => {
    await expect(
      сохранитьНастройкиИИ({ provider: "yandex" }),
    ).rejects.toThrow(/неизвестный провайдер/i);
  });

  it("настройка хранится одной записью, а не растёт с каждым сохранением", async () => {
    await сохранитьНастройкиИИ({ provider: "anthropic" });
    await сохранитьНастройкиИИ({ provider: "openai" });

    expect(await AiSettings.countDocuments()).toBe(1);
  });

  it("ключи API в базу не попадают", async () => {
    // Ключ, попавший в базу, попадает и в резервную копию, и в выгрузку.
    await сохранитьНастройкиИИ({ provider: "anthropic" });
    const запись = await AiSettings.findOne({ key: "ai" }).lean();

    expect(JSON.stringify(запись)).not.toMatch(/sk-|api[_-]?key/i);
  });

  it("после смены настройки следующее задание идёт к новому провайдеру", async () => {
    // Кэш живёт секунды, но запись обязана сбросить его немедленно: иначе
    // администратор нажал, а очередь ещё пять секунд работает по-старому и
    // выглядит это как «не сохранилось».
    await сохранитьНастройкиИИ({ provider: "anthropic" });
    expect((await провайдерДля("summary")).provider).toBe("anthropic");

    await сохранитьНастройкиИИ({ provider: "openai" });
    expect((await провайдерДля("summary")).provider).toBe("openai");
  });

  it("сводка перечисляет все назначения — экран строится по ней", async () => {
    const всё = await настройкиИИ({ fresh: true });
    expect(Object.keys(всё.tasks)).toEqual(
      expect.arrayContaining([
        "translation",
        "chat",
        "summary",
        "consultation",
        "speech",
        "image",
      ]),
    );
  });
});
