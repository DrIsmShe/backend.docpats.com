// __tests__/diagnostics/dicom.test.js
//
// Разбор DICOM: обезличивание, окно, отказ от сжатых файлов.
//
// Самое важное здесь — PHI. В обычном JPEG врач видит глазами всё, что на нём
// есть. В DICOM имя пациента и номер карты лежат в тегах: врач их НЕ ВИДИТ и
// подтверждает обезличивание вслепую. Значит система обязана назвать их сама,
// до того как что-либо уйдёт наружу.
//
// DICOM для тестов собирается здесь же, байт за байтом: тащить бинарный
// образец в репозиторий ради нескольких проверок незачем, а собранный в коде
// файл заодно показывает, из чего DICOM состоит.

import { describe, it, expect } from "vitest";
import {
  looksLikeDicom,
  readDicom,
  describeDicomStudy,
} from "../../modules/diagnostics/ai/dicomReader.js";

/* ─── Сборка DICOM (Explicit VR Little Endian) ─────────────────────────── */

function elementString(group, element, vr, value) {
  const bytes = Buffer.from(value, "latin1");
  // Длина элемента обязана быть чётной — добиваем пробелом.
  const padded = bytes.length % 2 ? Buffer.concat([bytes, Buffer.from(" ")]) : bytes;
  const head = Buffer.alloc(8);
  head.writeUInt16LE(group, 0);
  head.writeUInt16LE(element, 2);
  head.write(vr, 4, 2, "latin1");
  head.writeUInt16LE(padded.length, 6);
  return Buffer.concat([head, padded]);
}

function elementUint16(group, element, value) {
  const buf = Buffer.alloc(10);
  buf.writeUInt16LE(group, 0);
  buf.writeUInt16LE(element, 2);
  buf.write("US", 4, 2, "latin1");
  buf.writeUInt16LE(2, 6);
  buf.writeUInt16LE(value, 8);
  return buf;
}

function elementPixelData(pixels) {
  const head = Buffer.alloc(12);
  head.writeUInt16LE(0x7fe0, 0);
  head.writeUInt16LE(0x0010, 2);
  head.write("OW", 4, 2, "latin1");
  head.writeUInt16LE(0, 6); // зарезервировано
  head.writeUInt32LE(pixels.length, 8);
  return Buffer.concat([head, pixels]);
}

function buildDicom({ withPhi = true, transferSyntax = "1.2.840.10008.1.2.1" } = {}) {
  const rows = 8;
  const cols = 8;

  // Градиент слева направо — видно, что окно применилось.
  const pixels = Buffer.alloc(rows * cols * 2);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      pixels.writeUInt16LE(x * 128, (y * cols + x) * 2);
    }
  }

  const meta = elementString(0x0002, 0x0010, "UI", transferSyntax);
  const metaLen = Buffer.alloc(12);
  metaLen.writeUInt16LE(0x0002, 0);
  metaLen.writeUInt16LE(0x0000, 2);
  metaLen.write("UL", 4, 2, "latin1");
  metaLen.writeUInt16LE(4, 6);
  metaLen.writeUInt32LE(meta.length, 8);

  const phi = withPhi
    ? Buffer.concat([
        elementString(0x0010, 0x0010, "PN", "IVANOV^IVAN"),
        elementString(0x0010, 0x0020, "LO", "MRN-778812"),
        elementString(0x0010, 0x0030, "DA", "19780514"),
        elementString(0x0008, 0x0050, "SH", "ACC-99120"),
        elementString(0x0008, 0x0080, "LO", "CITY HOSPITAL 3"),
      ])
    : Buffer.alloc(0);

  const body = Buffer.concat([
    phi,
    elementString(0x0008, 0x0060, "CS", "CT"),
    elementString(0x0008, 0x1030, "LO", "CT PARANASAL SINUSES"),
    elementString(0x0008, 0x103e, "LO", "CORONAL"),
    elementString(0x0018, 0x0015, "CS", "SINUS"),
    elementString(0x0018, 0x0050, "DS", "1.0"),
    elementUint16(0x0028, 0x0002, 1),
    elementString(0x0028, 0x0004, "CS", "MONOCHROME2"),
    elementUint16(0x0028, 0x0010, rows),
    elementUint16(0x0028, 0x0011, cols),
    elementUint16(0x0028, 0x0100, 16),
    elementUint16(0x0028, 0x0103, 0),
    elementString(0x0028, 0x1050, "DS", "512"),
    elementString(0x0028, 0x1051, "DS", "1024"),
    elementPixelData(pixels),
  ]);

  return Buffer.concat([
    Buffer.alloc(128),
    Buffer.from("DICM", "latin1"),
    metaLen,
    meta,
    body,
  ]);
}

/* ─── Тесты ───────────────────────────────────────────────────────────── */

describe("распознавание DICOM", () => {
  it("узнаёт файл по маркеру DICM, а не по расширению или mime", () => {
    expect(looksLikeDicom(buildDicom())).toBe(true);
    expect(looksLikeDicom(Buffer.from("обычный текст"))).toBe(false);
    expect(looksLikeDicom(Buffer.alloc(0))).toBe(false);
  });
});

describe("личные данные в тегах", () => {
  it("называет все найденные личные поля: врач их не видит и подтверждает вслепую", async () => {
    const read = await readDicom(buildDicom({ withPhi: true }));
    expect(read.phiFields).toEqual(
      expect.arrayContaining([
        "имя пациента",
        "идентификатор пациента",
        "дата рождения",
        "номер обращения (accession)",
        "название учреждения",
      ]),
    );
  });

  it("не возвращает сами значения — только названия полей", async () => {
    const read = await readDicom(buildDicom({ withPhi: true }));
    const dump = JSON.stringify({ ...read, png: undefined });
    // Ни одно значение из тегов не должно просочиться в ответ, журнал и промпт.
    expect(dump).not.toMatch(/IVANOV/i);
    expect(dump).not.toMatch(/MRN-778812/);
    expect(dump).not.toMatch(/19780514/);
    expect(dump).not.toMatch(/ACC-99120/);
    expect(dump).not.toMatch(/CITY HOSPITAL/i);
  });

  it("на обезличенном файле не выдумывает полей", async () => {
    const read = await readDicom(buildDicom({ withPhi: false }));
    expect(read.phiFields).toEqual([]);
  });
});

describe("отрисовка среза", () => {
  it("превращает пиксели в PNG и определяет модальность по тегу", async () => {
    const read = await readDicom(buildDicom());
    expect(read.mimeType).toBe("image/png");
    expect(read.png.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(read.modalityKey).toBe("ct");
    expect(read.study.rows).toBe(8);
    expect(read.study.window).toMatch(/из файла/);
  });

  it("описание для модели без личных данных и честно называет срез срезом", async () => {
    const read = await readDicom(buildDicom({ withPhi: true }));
    const text = describeDicomStudy(read.study);
    expect(text).not.toMatch(/IVANOV|MRN|CITY HOSPITAL/i);
    expect(text).toMatch(/ОДИН срез из серии, а не исследование целиком/);
    expect(text).toMatch(/CT/);
  });
});

describe("сжатые файлы", () => {
  it("отказывается вместо того, чтобы отрисовать мусор", async () => {
    // JPEG 2000 — dicom-parser не распаковывает. Отрисовать «как получится»
    // нельзя: по искажённой картинке сделают клинический вывод.
    const compressed = buildDicom({ transferSyntax: "1.2.840.10008.1.2.4.90" });
    await expect(readDicom(compressed)).rejects.toThrow(/сжат|JPEG 2000/i);
  });

  it("даже при отказе сообщает, что файл не обезличен", async () => {
    expect.assertions(2);
    const compressed = buildDicom({
      transferSyntax: "1.2.840.10008.1.2.4.90",
      withPhi: true,
    });
    await readDicom(compressed).catch((err) => {
      expect(err.compressed).toBe(true);
      expect(err.phiFields).toContain("имя пациента");
    });
  });
});
