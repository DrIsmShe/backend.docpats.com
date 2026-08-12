// __tests__/userSynthesis/generateLimit.test.js
//
// Отказ гостю на второй генерации — то, ради чего заводился учёт.
//
// Вызов модели замокан: проверяется не качество статьи, а что до модели дело
// вообще не доходит, когда бесплатная попытка израсходована. Именно этот шаг
// стоит денег, и именно он был открыт всему интернету без счётчика.

import { describe, it, expect, beforeEach, vi } from "vitest";

const createMock = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    constructor() {
      this.messages = { create: createMock };
    }
  },
}));

const GuestUsage = (await import("../../common/models/system/GuestUsage.js")).default;
const { generateUserSynthesis, checkUserLimit } = await import(
  "../../modules/userSynthesis/userSynthesis.service.js"
);

const article = (text) => ({
  content: [{ type: "text", text }],
  usage: { input_tokens: 100, output_tokens: 200 },
});

const guestReq = (ip = "5.5.5.5") => ({ ip });

beforeEach(async () => {
  createMock.mockReset();
  createMock.mockResolvedValue(
    article("# Заголовок\n\nТекст статьи для проверки."),
  );
  await GuestUsage.deleteMany({});
});

describe("генерация для гостя", () => {
  const args = {
    userId: null,
    topic: "Артериальная гипертензия",
    language: "ru",
    style: "analytical",
  };

  it("первая статья создаётся", async () => {
    const res = await generateUserSynthesis({ ...args, req: guestReq() });

    expect(res).toBeTruthy();
    expect(createMock).toHaveBeenCalled();
  });

  it("вторая — отклоняется, и модель НЕ вызывается", async () => {
    await generateUserSynthesis({ ...args, req: guestReq() });
    createMock.mockClear();

    await expect(
      generateUserSynthesis({ ...args, req: guestReq() }),
    ).rejects.toThrow(/Лимит исчерпан/);

    // Главное: денег вторая попытка не стоила.
    expect(createMock).not.toHaveBeenCalled();
  });

  it("без сведений о запросе гостю отказывают, а не пускают", async () => {
    // Раньше отсутствие userId означало «можно». Теперь неизвестный гость —
    // это отказ: не сумели посчитать, значит не тратим.
    await expect(generateUserSynthesis({ ...args })).rejects.toThrow(
      /Лимит исчерпан/,
    );
    expect(createMock).not.toHaveBeenCalled();
  });

  it("счётчик на странице не расходует попытку", async () => {
    const before = await checkUserLimit(null, { req: guestReq("6.6.6.6") });
    const after = await checkUserLimit(null, { req: guestReq("6.6.6.6") });

    expect(before.used).toBe(0);
    expect(after.used).toBe(0);
    expect(after.allowed).toBe(true);
  });

  it("после расхода счётчик показывает исчерпание", async () => {
    await generateUserSynthesis({ ...args, req: guestReq("7.7.7.7") });

    const state = await checkUserLimit(null, { req: guestReq("7.7.7.7") });

    expect(state.used).toBe(1);
    expect(state.allowed).toBe(false);
    expect(state.plan).toBe("guest");
  });
});
