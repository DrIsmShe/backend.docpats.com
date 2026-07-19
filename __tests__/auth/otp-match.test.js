// __tests__/auth/otp-match.test.js
//
// Сверка OTP при смене пароля: регистронезависимая (код — HEX, но юзер мог
// ввести в нижнем регистре), но по значению — строгая.

import { describe, it, expect } from "vitest";
import { otpMatches } from "../../modules/auth/controllers/changePasswordController.js";

describe("otpMatches — сверка кода сброса пароля", () => {
  it("совпадает независимо от регистра HEX-кода", () => {
    expect(otpMatches("a1b2c3d4", "A1B2C3D4")).toBe(true);
    expect(otpMatches("A1B2C3D4", "a1b2c3d4")).toBe(true);
    expect(otpMatches(" A1B2C3D4 ", "A1B2C3D4")).toBe(true); // с пробелами
  });

  it("6-значный числовой код совпадает как есть", () => {
    expect(otpMatches("123456", "123456")).toBe(true);
  });

  it("неверный код не совпадает", () => {
    expect(otpMatches("A1B2C3D5", "A1B2C3D4")).toBe(false);
    expect(otpMatches("", "A1B2C3D4")).toBe(false);
    expect(otpMatches("A1B2C3D4", "")).toBe(false);
    expect(otpMatches(null, "A1B2C3D4")).toBe(false);
  });
});
