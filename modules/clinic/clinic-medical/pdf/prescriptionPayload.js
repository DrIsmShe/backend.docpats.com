// modules/clinic/clinic-medical/pdf/prescriptionPayload.js
//
// Сборка данных для бланка рецепта.
//
// Бланк печатается из трёх мест: клиника (карта пациента), пациентский
// портал (свои рецепты) и кабинет врача (частный пациент). Раньше каждое
// собирало данные само, и они разошлись: пациентский портал отдавал
// документ модели как есть, поэтому в графе «Приём» печатался шифртекст
// вместо указаний, а пол, вес и аллергии не печатались вовсе.
//
// Здесь собрано всё, что бланку нужно, но чего нет в самом рецепте:
// возраст (не храним — протухнет через год), аллергии (лежат отдельными
// записями), имя врача (в рецепте только идентификаторы).

import { decryptPHI } from "../../../../common/utils/phiCrypto.js";

// ── Возраст на момент печати ────────────────────────────────────────────
export function ageFromDob(dob) {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const before =
    now.getUTCMonth() < d.getUTCMonth() ||
    (now.getUTCMonth() === d.getUTCMonth() && now.getUTCDate() < d.getUTCDate());
  if (before) age -= 1;
  return age < 0 || age > 130 ? null : age;
}

// ── Аллергии пациента одной строкой ─────────────────────────────────────
// Единственное поле бланка, из-за которого рецепт может убить: печатать
// пустую рамку, когда записи в карте есть, нельзя.
export async function allergiesFor(patientId) {
  if (!patientId) return "";
  try {
    const { default: AllergiesPatient } = await import(
      "../../../../common/models/Polyclinic/MedicalHistory/allergiesPatient.js"
    );
    const rows = await AllergiesPatient.find({ patientId })
      .select("content")
      .lean();
    return rows
      .map((r) => String(r.content || "").trim())
      .filter(Boolean)
      .join("; ");
  } catch (e) {
    console.error("[рецепт] аллергии не прочитаны:", e.message);
    return "";
  }
}

/**
 * Пациент в том виде, в каком его ждёт генератор.
 *
 * virtuals: true обязателен — имя, телефон и почта хранятся зашифрованными
 * и отдаются виртуальными полями; обычный toObject() их не включает, и
 * бланк печатал пустые линии при заполненной карте.
 */
export async function buildPatientForPdf(patient, { allergies } = {}) {
  if (!patient) return null;
  const plain =
    typeof patient.toObject === "function"
      ? patient.toObject({ virtuals: true })
      : { ...patient };

  // Три модели карт называют одно и то же по-разному: клиника хранит
  // dateOfBirth и phone, карты врача — birthDate и phoneNumber. Приводим
  // здесь, чтобы генератор бланка не знал о трёх схемах: он и так печатает
  // один и тот же бланк, откуда бы рецепт ни пришёл.
  const dateOfBirth = plain.dateOfBirth || plain.birthDate || null;
  const phone = plain.phone || plain.phoneNumber || null;

  return {
    ...plain,
    dateOfBirth,
    phone,
    age: ageFromDob(dateOfBirth),
    allergiesSummary:
      allergies !== undefined ? allergies : await allergiesFor(plain._id),
  };
}

/**
 * Кто выписал. В рецепте хранятся только идентификаторы: врач — User,
 * сотрудник клиники — ClinicEmployee, у каждого своя схема шифрования.
 * Не нашли — печатаем бланк без имени: рецепт важнее подписи.
 */
export async function resolvePrescriber(prescription) {
  const id = (v) => (v && typeof v === "object" ? v._id : v) || null;
  const userId =
    id(prescription?.issuedByUserId) || id(prescription?.createdBy);
  const employeeId =
    id(prescription?.issuedByEmployeeId) || id(prescription?.createdByEmployee);

  try {
    if (userId) {
      const { default: User } = await import(
        "../../../../common/models/Auth/users.js"
      );
      // Без .lean(): расшифровка живёт в методе документа.
      const u = await User.findById(userId)
        .select("firstNameEncrypted lastNameEncrypted emailEncrypted specialization")
        .populate("specialization", "name");
      if (u) {
        const f = typeof u.decryptFields === "function" ? u.decryptFields() : {};

        // Номер лицензии живёт в профиле врача, а не в учётной записи:
        // на бланке это графа «Регистрационный номер», без неё рецепт,
        // выписанный вне клиники, в аптеке недействителен.
        let licenseNumber = null;
        try {
          const { default: ProfileDoctor } = await import(
            "../../../../common/models/DoctorProfile/profileDoctor.js"
          );
          const prof = await ProfileDoctor.findOne({ userId })
            .select("licenseNumber")
            .lean();
          licenseNumber = prof?.licenseNumber || null;
        } catch (e) {
          // Профиля нет — печатаем бланк без номера. Рецепт важнее.
          console.error("[рецепт] лицензия врача не прочитана:", e.message);
        }

        return {
          doctorName: [f.firstName, f.lastName].filter(Boolean).join(" ") || null,
          doctorQualification: u.specialization?.name || null,
          doctorLicenseNumber: licenseNumber,
          // Нужна шапке бланка, который врач выписывает сам, без клиники:
          // там вместо реквизитов учреждения стоят его собственные.
          // Телефона у пользователя в модели нет — только почта.
          doctorEmail: f.email || null,
        };
      }
    } else if (employeeId) {
      const { default: ClinicEmployee, decryptValue } = await import(
        "../../clinic-staff/models/clinicEmployee.model.js"
      );
      const emp = await ClinicEmployee.findById(employeeId)
        .select("firstNameEncrypted lastNameEncrypted")
        .lean();
      if (emp) {
        return {
          doctorName:
            [decryptValue(emp.firstNameEncrypted), decryptValue(emp.lastNameEncrypted)]
              .filter(Boolean)
              .join(" ") || null,
        };
      }
    }
  } catch (e) {
    console.error("[рецепт] врач не определён:", e.message);
  }
  return {};
}

/**
 * Рецепт из документа модели в форму, которую ждёт генератор.
 *
 * Нужен там, где документ читается напрямую (пациентский портал, кабинет
 * врача), а не через clinic-сервис: указания к приёму, текст диагноза и
 * общие замечания хранятся зашифрованными.
 */
export function decryptPrescriptionDoc(rx) {
  if (!rx) return null;
  const safe = (v) => {
    try {
      return decryptPHI(v) || "";
    } catch {
      return "";
    }
  };
  return {
    _id: String(rx._id),
    status: rx.status,
    issuedAt: rx.issuedAt || rx.createdAt || null,
    createdAt: rx.createdAt || null,
    createdBy: rx.createdBy || null,
    createdByEmployee: rx.createdByEmployee || null,
    createdByClinicId: rx.createdByClinicId || null,
    issuedByUserId: rx.issuedByUserId || null,
    issuedByEmployeeId: rx.issuedByEmployeeId || null,
    diagnosis: rx.diagnosis
      ? {
          code: rx.diagnosis.code || "",
          codeTitle: rx.diagnosis.codeTitle || "",
          text: safe(rx.diagnosis.text),
        }
      : null,
    generalNotes: safe(rx.generalNotes),
    substitutionAllowed: rx.substitutionAllowed ?? null,
    refills: rx.refills ?? null,
    validUntil: rx.validUntil || null,
    items: Array.isArray(rx.items)
      ? rx.items.map((it) => ({
          inn: it.inn || "",
          brandName: it.brandName || "",
          strength: it.strength || "",
          form: it.form || "other",
          route: it.route || "oral",
          dose: it.dose || "",
          frequency: it.frequency || "",
          duration: it.duration || "",
          quantity: it.quantity || "",
          prn: !!it.prn,
          instructions: safe(it.instructions),
        }))
      : [],
  };
}
