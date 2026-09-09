// Постановка задания на перевод.
//
// ЧТО ЗДЕСЬ ДЕРЖИТСЯ. У задания постоянный идентификатор («тип:id:язык»), а
// упавшие задания не удаляются — они нужны, чтобы сбой было видно. Обратная
// сторона: по такому идентификатору BullMQ новое задание молча НЕ добавляет,
// а лог при этом рапортует «Job added to queue». Именно так перевод статей
// оставался мёртвым после переезда на другого провайдера: сорок одно
// задание лежало в failed с ошибкой оплаты OpenAI, и каждая новая попытка
// упиралась в них.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { queueMock } = vi.hoisted(() => ({
  queueMock: {
    getJobCounts: vi.fn(),
    getJob: vi.fn(),
    add: vi.fn(),
  },
}));

vi.mock("../../modules/translation/translation.queue.js", () => ({
  translationQueue: queueMock,
}));

const { enqueueTranslation } = await import(
  "../../modules/translation/translation.service.js"
);

const ЗАДАНИЕ = {
  entity: { _id: "6aa12d3b33f50b91cad3f11b", title: "Храп" },
  entityType: "ArticleScine",
  targetLanguage: "az",
};

const ключ = "ArticleScine:6aa12d3b33f50b91cad3f11b:az";

beforeEach(() => {
  queueMock.getJobCounts.mockReset();
  queueMock.getJob.mockReset();
  queueMock.add.mockReset();
  queueMock.getJobCounts.mockResolvedValue({ waiting: 0 });
  queueMock.getJob.mockResolvedValue(null);
});

describe("постановка перевода в очередь", () => {
  it("ставит задание, когда прежнего нет", async () => {
    await enqueueTranslation(ЗАДАНИЕ);

    expect(queueMock.add).toHaveBeenCalledTimes(1);
    expect(queueMock.add.mock.calls[0][2].jobId).toBe(ключ);
  });

  it("упавшее задание убирает и ставит заново", async () => {
    // Иначе перевод этой статьи на этот язык не повторится никогда.
    const remove = vi.fn();
    queueMock.getJob.mockResolvedValue({
      getState: async () => "failed",
      remove,
    });

    await enqueueTranslation(ЗАДАНИЕ);

    expect(remove).toHaveBeenCalled();
    expect(queueMock.add).toHaveBeenCalledTimes(1);
  });

  it("работающее задание не трогает", async () => {
    // Удалить его — значит оборвать перевод на середине и оплатить его
    // заново.
    const remove = vi.fn();
    queueMock.getJob.mockResolvedValue({
      getState: async () => "active",
      remove,
    });

    await enqueueTranslation(ЗАДАНИЕ);

    expect(remove).not.toHaveBeenCalled();
    expect(queueMock.add).not.toHaveBeenCalled();
  });

  it("ждущее задание не дублирует", async () => {
    queueMock.getJob.mockResolvedValue({
      getState: async () => "waiting",
      remove: vi.fn(),
    });

    await enqueueTranslation(ЗАДАНИЕ);

    expect(queueMock.add).not.toHaveBeenCalled();
  });

  it("сбой проверки прежнего задания не отменяет постановку", async () => {
    // Очередь может быть недоступна на секунду; терять из-за этого перевод
    // хуже, чем поставить задание, которое, возможно, уже есть.
    queueMock.getJob.mockRejectedValue(new Error("redis недоступен"));

    await enqueueTranslation(ЗАДАНИЕ);

    expect(queueMock.add).toHaveBeenCalledTimes(1);
  });

  it("перегруженную очередь не наполняет дальше", async () => {
    queueMock.getJobCounts.mockResolvedValue({ waiting: 100000 });

    await enqueueTranslation(ЗАДАНИЕ);

    expect(queueMock.add).not.toHaveBeenCalled();
  });
});
