// __tests__/ebm/pubmedClient.test.js
//
// Клиент к NCBI. Проверяется поведение на границе с чужим сервисом: как
// разбирается ответ и что происходит при отказе.
//
// Ограничитель частоты покрыт отдельно и намеренно: NCBI за превышение
// блокирует АДРЕС СЕРВЕРА, то есть отнимает PubMed сразу у всего проекта, и
// снимается такая блокировка вручную и долго.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { esearch, esummary } from "../../modules/ebm/services/pubmed.service.js";

let fetchMock;

beforeEach(() => {
  fetchMock = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  vi.restoreAllMocks();
});

const ok = (body) => ({ ok: true, status: 200, json: async () => body });

describe("esearch", () => {
  it("возвращает общее число отдельно от списка идентификаторов", async () => {
    fetchMock.mockResolvedValue(
      ok({ esearchresult: { count: "1130", idlist: ["1", "2"] } }),
    );

    const res = await esearch("metformin", { limit: 2 });

    // count — сколько ЕСТЬ, а не сколько вернули. По нему видно, есть ли по
    // вопросу литература вообще.
    expect(res.count).toBe(1130);
    expect(res.ids).toEqual(["1", "2"]);
  });

  it("отдаёт слова, которых PubMed не знает", async () => {
    fetchMock.mockResolvedValue(
      ok({
        esearchresult: {
          count: "0",
          idlist: [],
          errorlist: { phrasesnotfound: ["metfrmin"] },
          warninglist: { phrasesignored: ["the"] },
        },
      }),
    );

    const res = await esearch("metfrmin the");

    // Без этого потерю слова не отличить от честного «ничего нет»: PubMed
    // не сообщает об ошибке, он просто молча выбрасывает непонятое.
    expect(res.notFound).toContain("metfrmin");
    expect(res.notFound).toContain("the");
  });

  it("превращает ошибку NCBI в исключение, а не в пустой результат", async () => {
    fetchMock.mockResolvedValue(
      ok({ esearchresult: { ERROR: "Invalid db name" } }),
    );

    await expect(esearch("metformin")).rejects.toThrow(/Invalid db name/);
  });

  it("представляется NCBI: tool и email", async () => {
    fetchMock.mockResolvedValue(ok({ esearchresult: { count: "0", idlist: [] } }));

    await esearch("metformin");

    // NCBI просит представляться, чтобы связаться с нами, если запросы начнут
    // мешать, — вместо того чтобы молча заблокировать адрес.
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get("tool")).toBe("docpats-ebm");
    expect(url.searchParams.get("email")).toBeTruthy();
  });
});

describe("esummary", () => {
  it("не ходит в сеть на пустом списке", async () => {
    const res = await esummary([]);

    expect(res).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("пропускает идентификаторы, которых нет в ответе", async () => {
    fetchMock.mockResolvedValue(
      ok({
        result: {
          uids: ["1"],
          1: {
            uid: "1",
            title: "A study",
            source: "BMJ",
            pubdate: "2019",
            authors: [],
            articleids: [],
            pubtype: [],
          },
        },
      }),
    );

    // Второй запрошен, но не вернулся. Придумывать за PubMed нечего — просто
    // не показываем.
    const res = await esummary(["1", "2"]);

    expect(res).toHaveLength(1);
    expect(res[0].pmid).toBe("1");
  });

  it("берёт год из любой формы даты", async () => {
    fetchMock.mockResolvedValue(
      ok({
        result: {
          uids: ["1"],
          1: {
            uid: "1",
            title: "T",
            source: "S",
            // Встречается и «2023», и «2023 Apr 15», и «2023 Spring».
            pubdate: "2023 Spring",
            authors: [],
            articleids: [],
            pubtype: [],
          },
        },
      }),
    );

    const res = await esummary(["1"]);

    expect(res[0].year).toBe(2023);
  });

  it("помечает работы, вышедшие до номера журнала", async () => {
    fetchMock.mockResolvedValue(
      ok({
        result: {
          uids: ["1"],
          1: {
            uid: "1",
            title: "T",
            source: "S",
            pubdate: "2026",
            authors: [],
            articleids: [],
            pubtype: [],
            pubstatus: "aheadofprint",
          },
        },
      }),
    );

    const res = await esummary(["1"]);

    // Для врача это важно: данные свежие, но окончательная версия может
    // отличаться от прочитанной.
    expect(res[0].aheadOfPrint).toBe(true);
  });
});

describe("отказы NCBI", () => {
  it("повторяет запрос один раз при 429", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) })
      .mockResolvedValueOnce(ok({ esearchresult: { count: "5", idlist: [] } }));

    // Раскладка по ступеням — шесть обращений подряд; ронять весь ответ врача
    // из-за того, что NCBI притормозил на одном, несоразмерно.
    const res = await esearch("metformin");

    expect(res.count).toBe(5);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 15000);

  it("после второго 429 сдаётся, а не долбится дальше", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });

    // Упорство при 429 ведёт к блокировке адреса сервера — то есть отнимает
    // PubMed у всего проекта.
    await expect(esearch("metformin")).rejects.toThrow(/частот/i);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 15000);

  it("сообщает код, когда NCBI отвечает ошибкой", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });

    await expect(esearch("metformin")).rejects.toThrow(/503/);
  });
});
