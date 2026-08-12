// __tests__/ebm/ebmHttp.test.js
//
// Поиск доказательств НА УРОВНЕ HTTP.
//
// Тесты сервиса вызывают функции напрямую и не проходят ни через разбор строки
// запроса, ни через авторизацию. А именно там решается, кого сюда пускать, —
// ошибка в этом слое тестам сервиса не видна вовсе.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";

// Разбор вопроса замокан: живой вызов модели в HTTP-тестах стоил бы денег и
// зависел бы от сети. Логика самого разбора покрыта в question.test.js.
const askMock = vi.fn();

vi.mock("../../modules/ebm/services/question.service.js", () => ({
  askEvidence: (...args) => askMock(...args),
  isAiConfigured: () => true,
}));

import ebmRouter from "../../modules/ebm/routes/ebm.routes.js";
import { requireMedicalStaff } from "../../modules/ebm/middlewares/ebmAuth.js";
import { createTestDoctor } from "../helpers/createTestUser.js";
import { errorHandler } from "../../common/middlewares/errorHandler.js";

/**
 * Пользователь с нужной ролью. Через общий хелпер, потому что модель User
 * требует зашифрованные поля и их хеши уже на этапе валидации.
 *
 * Роли берутся из enum User.role: doctor, patient, admin, clinic_admin,
 * clinic_staff.
 */
async function makeUser(role, extra = {}) {
  const { userId } = await createTestDoctor({
    role,
    isDoctor: role === "doctor",
    isPatient: role === "patient",
    ...extra,
  });
  return userId;
}

/** Мини-приложение с настоящим роутером и настоящей проверкой доступа. */
function makeApp({ userId = null } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = userId ? { userId: String(userId) } : {};
    next();
  });
  app.use("/ebm", requireMedicalStaff, ebmRouter);
  app.use(errorHandler);
  return app;
}

let fetchMock;

beforeEach(() => {
  // PubMed замокан: HTTP-тесты не должны зависеть от связи с США и не должны
  // тратить общий на весь проект лимит NCBI.
  fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    const parsed = new URL(String(url));
    const body = parsed.pathname.endsWith("esearch.fcgi")
      ? { esearchresult: { count: "10", idlist: ["1"] } }
      : {
          result: {
            uids: ["1"],
            1: {
              uid: "1",
              title: "A meta-analysis",
              source: "BMJ",
              pubdate: "2024",
              authors: [],
              articleids: [{ idtype: "pubmed", value: "1" }],
              pubtype: ["Meta-Analysis"],
            },
          },
        };
    return { ok: true, status: 200, json: async () => body };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("доступ", () => {
  it("без сессии — 401, и PubMed не тревожим", async () => {
    const res = await request(makeApp()).get("/ebm/search?q=metformin");

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("пациенту — 403", async () => {
    const patient = await makeUser("patient");

    const res = await request(makeApp({ userId: patient })).get(
      "/ebm/search?q=metformin",
    );

    // Прячем не данные (PubMed открыт всем), а интерфейс: список исследований
    // читается пациентом как «назначь себе лечение сам».
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("заблокированному врачу — 403", async () => {
    const blocked = await makeUser("doctor", { isBlocked: true });

    const res = await request(makeApp({ userId: blocked })).get(
      "/ebm/search?q=metformin",
    );

    expect(res.status).toBe(403);
  });

  it("врачу — 200", async () => {
    const doctor = await makeUser("doctor");

    const res = await request(makeApp({ userId: doctor })).get(
      "/ebm/search?q=metformin&levels=meta_analysis",
    );

    expect(res.status).toBe(200);
    expect(res.body.levels[0].items[0].title).toBe("A meta-analysis");
    expect(res.body.verdict).toBeTruthy();
  });
});

describe("разбор параметров", () => {
  let doctor;

  beforeEach(async () => {
    doctor = await makeUser("doctor");
  });

  const get = (path) => request(makeApp({ userId: doctor })).get(path);

  it("отвергает слишком короткий запрос", async () => {
    const res = await get("/ebm/search?q=ab");

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("отвергает неизвестную ступень", async () => {
    // Молча проигнорировать нельзя: врач получил бы не тот срез, о котором
    // просил, и не узнал бы об этом.
    const res = await get("/ebm/search?q=metformin&levels=nonsense");

    expect(res.status).toBe(400);
    expect(res.body.message || res.body.error).toMatch(/nonsense/);
  });

  it("зажимает perLevel вместо отказа", async () => {
    // perLevel уходит в retmax NCBI, поэтому пропустить нельзя. Но отвечать
    // ошибкой на «хочу побольше» невежливо — зажимаем молча.
    const res = await get("/ebm/search?q=metformin&perLevel=1000&levels=rct");

    expect(res.status).toBe(200);
    const retmax = new URL(String(fetchMock.mock.calls[1][0])).searchParams.get(
      "retmax",
    );
    expect(Number(retmax)).toBeLessThanOrEqual(20);
  });

  it("не ломается на нечисловых параметрах", async () => {
    const res = await get("/ebm/search?q=metformin&years=abc&perLevel=&levels=rct");

    expect(res.status).toBe(200);
  });

  it("отдаёт справочник ступеней", async () => {
    const res = await get("/ebm/levels");

    expect(res.status).toBe(200);
    expect(res.body.levels.map((l) => l.key)).toContain("meta_analysis");
    // Порядок смысловой, а не алфавитный: он и есть иерархия доказательств.
    expect(res.body.levels.map((l) => l.rank)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("свободный вопрос", () => {
  let doctor;

  beforeEach(async () => {
    doctor = await makeUser("doctor");
    askMock.mockReset();
    askMock.mockResolvedValue({
      question: "q",
      usedQuery: "(metformin)",
      widened: false,
      understood: { isClinical: true, pico: {} },
      levels: [],
      verdict: { kind: "strong", text: "…" },
    });
  });

  const post = (body) =>
    request(makeApp({ userId: doctor })).post("/ebm/ask").send(body);

  it("без сессии — 401, модель не трогаем", async () => {
    const res = await request(makeApp())
      .post("/ebm/ask")
      .send({ question: "Помогает ли метформин при преддиабете?" });

    expect(res.status).toBe(401);
    expect(askMock).not.toHaveBeenCalled();
  });

  it("врачу — 200, вопрос уходит в разбор", async () => {
    const res = await post({ question: "Помогает ли метформин при преддиабете?" });

    expect(res.status).toBe(200);
    expect(askMock).toHaveBeenCalledWith(
      expect.objectContaining({
        question: "Помогает ли метформин при преддиабете?",
      }),
    );
    // Врач должен видеть, по какому запросу ему ответили.
    expect(res.body.usedQuery).toBe("(metformin)");
  });

  it("отвергает пустой вопрос, не тратя вызов модели", async () => {
    const res = await post({ question: "  " });

    expect(res.status).toBe(400);
    expect(askMock).not.toHaveBeenCalled();
  });

  it("зажимает perLevel и years", async () => {
    await post({ question: "вопрос про метформин", perLevel: 999, years: 999 });

    const args = askMock.mock.calls[0][0];
    expect(args.perLevel).toBeLessThanOrEqual(20);
    expect(args.yearsBack).toBeLessThanOrEqual(50);
  });

  it("сообщает интерфейсу, настроен ли разбор вопросов", async () => {
    // Без ключа модели поле свободного вопроса показывать незачем, а поиск по
    // запросу PubMed работает в любом случае.
    const res = await request(makeApp({ userId: doctor })).get("/ebm/status");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ask: true, search: true });
  });
});
