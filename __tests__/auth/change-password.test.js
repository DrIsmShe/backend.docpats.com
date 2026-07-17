// __tests__/auth/change-password.test.js
//
// Регрессионный тест на закрытую дыру: раньше POST /auth/change-password менял
// пароль, зная ТОЛЬКО email — без кода подтверждения. То есть, зная чужой
// email, можно было сменить пароль и войти в аккаунт с медданными.
//
// Теперь смена требует валидный одноразовый код (User.otpPassword), не
// истёкший по User.otpExpiresAt. Здесь мы дёргаем контроллер напрямую с
// замоканной моделью — БЕЗ базы и почтового сервиса, чтобы проверить именно
// логику проверки кода.

import { describe, it, expect, beforeEach, vi } from "vitest";
import crypto from "crypto";
import argon2 from "argon2";

// ENCRYPTION_KEY нужен контроллеру на этапе импорта.
if (!process.env.ENCRYPTION_KEY) {
  process.env.ENCRYPTION_KEY = "test_encryption_key_padded_to_32_chars";
}

const findOne = vi.fn();
vi.mock("../../common/models/Auth/users.js", () => ({
  default: { findOne: (...a) => findOne(...a) },
}));

const { default: changePasswordController } = await import(
  "../../modules/auth/controllers/changePasswordController.js"
);

// Мини-заглушка res: res.status(n).json(body) с записью того, что вернули.
function makeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

const VALID_NEW = "BrandNewPass123!"; // проходит validatePassword-regex

async function makeUser({ otpPassword, otpAgeMs = 60_000, oldPassword }) {
  return {
    otpPassword,
    // код выдан otpAgeMs назад и живёт 5 минут → ещё валиден при 60 сек
    otpExpiresAt: otpPassword ? Date.now() - otpAgeMs + 5 * 60 * 1000 : null,
    password: oldPassword ? await argon2.hash(oldPassword) : null,
    saved: false,
    async save() {
      this.saved = true;
    },
  };
}

function callController(body) {
  const req = { body };
  const res = makeRes();
  return changePasswordController(req, res).then(() => res);
}

beforeEach(() => {
  findOne.mockReset();
});

describe("POST /auth/change-password — защита кодом подтверждения", () => {
  it("ДЫРА ЗАКРЫТА: без кода не меняет пароль (400 OTP_REQUIRED)", async () => {
    const user = await makeUser({ otpPassword: "A1B2C3D4" });
    findOne.mockResolvedValue(user);

    const res = await callController({
      email: "victim@example.com",
      newPassword: VALID_NEW,
      newRepeatPassword: VALID_NEW,
      // otpPassword НЕ передан — как в атаке «знаю только email»
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe("OTP_REQUIRED");
    expect(user.saved).toBe(false); // пароль не тронут
  });

  it("отклоняет неверный код (400) и не меняет пароль", async () => {
    const user = await makeUser({ otpPassword: "A1B2C3D4" });
    findOne.mockResolvedValue(user);

    const res = await callController({
      email: "victim@example.com",
      newPassword: VALID_NEW,
      newRepeatPassword: VALID_NEW,
      otpPassword: "WRONG999",
    });

    expect(res.statusCode).toBe(400);
    // Пароль не тронут (менялся бы только на успешном коде).
    expect(user.password).toBe(null);
    // M-1: неверная попытка засчитана (после лимита код гасится).
    expect(user.otpAttempts).toBe(1);
  });

  it("отклоняет истёкший код (400)", async () => {
    // код выдан 6 минут назад при TTL 5 минут → истёк
    const user = await makeUser({
      otpPassword: "A1B2C3D4",
      otpAgeMs: 6 * 60 * 1000,
    });
    findOne.mockResolvedValue(user);

    const res = await callController({
      email: "victim@example.com",
      newPassword: VALID_NEW,
      newRepeatPassword: VALID_NEW,
      otpPassword: "A1B2C3D4",
    });

    expect(res.statusCode).toBe(400);
    expect(user.saved).toBe(false);
  });

  it("не выдаёт, что пользователя нет — тот же 400, что и на неверный код", async () => {
    findOne.mockResolvedValue(null);

    const res = await callController({
      email: "ghost@example.com",
      newPassword: VALID_NEW,
      newRepeatPassword: VALID_NEW,
      otpPassword: "A1B2C3D4",
    });

    expect(res.statusCode).toBe(400);
    // текст без слова "not found" — чтобы нельзя было перечислять email
    expect(String(res.body.message).toLowerCase()).not.toContain("not found");
  });

  it("с верным кодом меняет пароль и гасит одноразовый код (и лишние пробелы не мешают)", async () => {
    const user = await makeUser({ otpPassword: "A1B2C3D4" });
    findOne.mockResolvedValue(user);

    const res = await callController({
      email: "victim@example.com",
      newPassword: VALID_NEW,
      newRepeatPassword: VALID_NEW,
      otpPassword: "  A1B2C3D4  ", // код из письма, случайные пробелы обрезаются
    });

    expect(res.statusCode).toBe(200);
    expect(user.saved).toBe(true);
    expect(user.otpPassword).toBeNull();
    expect(user.otpExpiresAt).toBeNull();
  });
});
