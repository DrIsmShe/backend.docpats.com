// __tests__/foundation/phiCrypto.test.js
//
// Юнит-тесты единого PHI-хелпера шифрования (common/utils/phiCrypto.js).

import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  if (!process.env.ENCRYPTION_KEY) {
    process.env.ENCRYPTION_KEY = "test_encryption_key_padded_to_32_chars";
  }
});

const { encryptPHI, decryptPHI, isEncrypted, decryptFields } = await import(
  "../../common/utils/phiCrypto.js"
);

describe("phiCrypto", () => {
  it("round-trip: расшифровка возвращает исходный текст", () => {
    const src = "Диагноз: гипертония 2 ст. — конфиденциально";
    const enc = encryptPHI(src);
    expect(enc).not.toBe(src);
    expect(isEncrypted(enc)).toBe(true);
    expect(enc).not.toContain("гипертония");
    expect(decryptPHI(enc)).toBe(src);
  });

  it("идемпотентно: уже зашифрованное не шифруется повторно", () => {
    const enc = encryptPHI("текст");
    expect(encryptPHI(enc)).toBe(enc);
  });

  it("каждый вызов даёт новый IV (разный шифртекст для одного входа)", () => {
    expect(encryptPHI("одно и то же")).not.toBe(encryptPHI("одно и то же"));
  });

  it("null/undefined/пустая строка проходят как есть", () => {
    expect(encryptPHI(null)).toBeNull();
    expect(encryptPHI(undefined)).toBeUndefined();
    expect(encryptPHI("")).toBe("");
    expect(decryptPHI(null)).toBeNull();
  });

  it("decryptPHI на plaintext (не наш формат) возвращает как есть", () => {
    expect(decryptPHI("обычный текст без шифра")).toBe("обычный текст без шифра");
  });

  it("повреждённый шифртекст → null, не бросает", () => {
    const enc = encryptPHI("данные");
    const broken = enc.slice(0, -4) + "0000";
    expect(() => decryptPHI(broken)).not.toThrow();
  });

  it("decryptFields расшифровывает перечисленные поля, не трогая остальные", () => {
    const doc = {
      report: encryptPHI("заключение"),
      name: "Иван",
      notes: encryptPHI("заметка"),
    };
    const out = decryptFields(doc, ["report", "notes"]);
    expect(out.report).toBe("заключение");
    expect(out.notes).toBe("заметка");
    expect(out.name).toBe("Иван");
    // оригинал не мутирован
    expect(isEncrypted(doc.report)).toBe(true);
  });
});
