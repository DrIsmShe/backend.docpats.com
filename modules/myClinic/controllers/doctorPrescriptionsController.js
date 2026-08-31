// modules/myClinic/controllers/doctorPrescriptionsController.js
//
// Рецепты, которые врач выписывает своему частному пациенту — вне клиники.
//
// Почему отдельно от clinic-medical. Тот сервис требует членства в клинике:
// он берёт clinicId из контекста арендатора и спрашивает права через RBAC
// клиники. У врача, ведущего частный приём, никакой клиники нет, и вызвать
// его нельзя. Модель рецепта такой случай предусматривает изначально —
// patientTypeModel умеет "DoctorPrivatePatient", а createdByClinicId
// обязателен только для сотрудника клиники, — поэтому здесь тонкий
// контроллер поверх той же модели и того же генератора бланка.
//
// Владение проверяется явно: пациент должен принадлежать этому врачу.
// resolvePatient находит карту по идентификатору, но НЕ проверяет, чья она.

import mongoose from "mongoose";
import Prescription from "../../../common/models/Polyclinic/Prescription.js";
import DoctorPrivatePatient from "../../../common/models/Polyclinic/DoctorPrivatePatient.js";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";
import { encryptPHI } from "../../../common/utils/phiCrypto.js";
import {
  normalizeItems,
  normalizeRefills,
  normalizeValidUntil,
} from "../../clinic/clinic-medical/services/prescription.service.js";
import {
  buildPatientForPdf,
  decryptPrescriptionDoc,
  resolvePrescriber,
} from "../../clinic/clinic-medical/pdf/prescriptionPayload.js";

// Карта пациента этого врача — или null.
//
// У врача два вида пациентов, и рецепт можно выписать обоим: частный
// (DoctorPrivatePatient, привязан к одному врачу) и зарегистрированный в
// поликлинике (NewPatientPolyclinic, привязан к нескольким — doctorId это
// массив). Модель рецепта различает их полем patientTypeModel, поэтому
// возвращаем и карту, и то, какой она модели.
async function ownedPatient(patientId, userId) {
  if (!mongoose.Types.ObjectId.isValid(patientId)) return null;

  const priv = await DoctorPrivatePatient.findById(patientId);
  if (priv) {
    const owner = String(priv.doctorUserId || "");
    return owner && owner === String(userId)
      ? { doc: priv, model: "DoctorPrivatePatient", type: "private" }
      : null;
  }

  const reg = await NewPatientPolyclinic.findById(patientId);
  if (reg) {
    const linked = (reg.doctorId || []).some(
      (id) => String(id) === String(userId),
    );
    return linked
      ? { doc: reg, model: "NewPatientPolyclinic", type: "registered" }
      : null;
  }

  return null;
}

// Другие карты того же человека.
//
// Связь между картами одна — привязка к учётной записи DocPats
// (linkedUserId). Нет привязки — нет и способа надёжно понять, что это тот
// же человек: совпадение имени таким способом не является.
async function relatedCards(card, exceptId) {
  const linked = card?.linkedUserId;
  if (!linked) return [];

  const { default: ClinicPatient } = await import(
    "../../clinic/clinic-patients/models/clinicPatient.model.js"
  );

  // skipTenantScope: читаем вне контекста клиники, и владение проверяется
  // не арендой, а авторством рецепта в запросе выше.
  const [clinicCards, privateCards, polyCards] = await Promise.all([
    ClinicPatient.find({ linkedUserId: linked })
      .setOptions({ skipTenantScope: true })
      .select("_id")
      .lean(),
    DoctorPrivatePatient.find({ linkedUserId: linked }).select("_id").lean(),
    NewPatientPolyclinic.find({ linkedUserId: linked }).select("_id").lean(),
  ]);

  return [...clinicCards, ...privateCards, ...polyCards]
    .map((c) => c._id)
    .filter((id) => String(id) !== String(exceptId));
}

// Наружу отдаём расшифрованный рецепт: клиент показывает его в списке.
function toApi(rx) {
  const d = decryptPrescriptionDoc(rx);
  return { ...d, createdAt: rx.createdAt, updatedAt: rx.updatedAt };
}

// ── Создать ─────────────────────────────────────────────────────────────
export async function createDoctorPrescription(req, res, next) {
  try {
    const userId = req.user?.userId || req.session?.userId;
    if (!userId) {
      return res.status(401).json({ ok: false, error: req.t("myClinic.auth.unauthorized") });
    }

    const patient = await ownedPatient(req.params.patientId, userId);
    if (!patient) {
      return res.status(404).json({ ok: false, error: req.t("myClinic.patient.notFound2") });
    }

    const body = req.body || {};
    const items = normalizeItems(body.items);
    if (items.length === 0) {
      return res.status(422).json({
        ok: false,
        error: req.t("myClinic.prescription.innRequired"),
      });
    }

    const diagnosis = body.diagnosis
      ? {
          code: (body.diagnosis.code || "").trim(),
          codeTitle: (body.diagnosis.codeTitle || "").trim(),
          text: encryptPHI((body.diagnosis.text || "").trim()), // PHI
        }
      : { code: "", codeTitle: "", text: "" };

    const rx = new Prescription({
      patientType: patient.type,
      patientTypeModel: patient.model,
      patientRef: patient.doc._id,

      // Врач — пользователь, а не сотрудник клиники: createdByClinicId не
      // ставим, и по его отсутствию бланк печатается под маркой проекта.
      createdBy: userId,
      createdByEmployee: null,
      issuedByUserId: userId,
      issuedAt: new Date(),
      status: "active",

      items,
      generalNotes: encryptPHI((body.generalNotes || "").trim()), // PHI
      diagnosis,
      substitutionAllowed:
        typeof body.substitutionAllowed === "boolean"
          ? body.substitutionAllowed
          : null,
      refills: normalizeRefills(body.refills),
      validUntil: normalizeValidUntil(body.validUntil),
    });

    await rx.save();
    return res.status(201).json({ ok: true, prescription: toApi(rx.toObject()) });
  } catch (err) {
    if (err?.name === "ValidationError" || err?.message?.includes("INN")) {
      return res.status(422).json({ ok: false, error: err.message });
    }
    return next ? next(err) : res.status(500).json({ ok: false });
  }
}

// ── Список по пациенту ──────────────────────────────────────────────────
export async function listDoctorPrescriptions(req, res, next) {
  try {
    const userId = req.user?.userId || req.session?.userId;
    if (!userId) {
      return res.status(401).json({ ok: false, error: req.t("myClinic.auth.unauthorized") });
    }

    const patient = await ownedPatient(req.params.patientId, userId);
    if (!patient) {
      return res.status(404).json({ ok: false, error: req.t("myClinic.patient.notFound2") });
    }

    // Что показываем в кабинете врача.
    //
    // У одного человека может быть несколько карт: клиническая, частная у
    // врача, поликлиническая. Рецепт привязан к КОНКРЕТНОЙ карте, поэтому
    // выписанный в клинике не появлялся на странице того же пациента в
    // личном кабинете врача — карты разные.
    //
    // Правило:
    //   • на этой карте — все рецепты;
    //   • на других картах того же человека — только те, что выписал САМ
    //     этот врач.
    //
    // Второе ограничение принципиальное. Рецепты, написанные другими
    // врачами клиники, принадлежат клинике, и доступ к ним идёт через
    // согласие пациента. Показывать их в личном кабинете значило бы
    // обойти согласие, которое весь остальной код аккуратно соблюдает. А
    // свой собственный рецепт врач вправе видеть везде: под ним стоит его
    // имя.
    const or = [
      { patientRef: patient.doc._id, patientTypeModel: patient.model },
    ];

    const otherCards = await relatedCards(patient.doc, patient.doc._id);
    if (otherCards.length) {
      or.push({ patientRef: { $in: otherCards }, createdBy: userId });
    }

    const rows = await Prescription.find({ $or: or })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    return res.json({ ok: true, prescriptions: rows.map(toApi) });
  } catch (err) {
    return next ? next(err) : res.status(500).json({ ok: false });
  }
}

// ── Правка ──────────────────────────────────────────────────────────────
//
// Те же правила, что в клинике: рецепт — документ, и переписывать его
// задним числом нельзя. Но опечатка, замеченная через минуту, — это
// опечатка, а не новый рецепт. Поэтому правка разрешена, пока бланк
// активен, и каждое изменение ложится в history со старым значением.
export async function updateDoctorPrescription(req, res, next) {
  try {
    const userId = req.user?.userId || req.session?.userId;
    if (!userId) {
      return res.status(401).json({ ok: false, error: req.t("myClinic.auth.unauthorized") });
    }
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ ok: false, error: req.t("myClinic.validation.invalidIdFormat") });
    }

    const rx = await Prescription.findById(req.params.id);
    if (!rx) {
      return res.status(404).json({ ok: false, error: req.t("myClinic.prescription.notFound") });
    }
    // Править может только автор: рецепт — документ с его именем.
    if (String(rx.createdBy || "") !== String(userId)) {
      return res.status(403).json({ ok: false, error: req.t("myClinic.access.denied") });
    }
    if (rx.status !== "active") {
      return res.status(409).json({
        ok: false,
        error:
          req.t("myClinic.prescription.cannotEditInactive"),
      });
    }

    // Отпуск по рецепту закрывает правку навсегда — то же правило, что в
    // клинике. Без него личный кабинет стал бы обходным путём: бумага на
    // руках у пациента разошлась бы с записью.
    try {
      const { default: DispenseLog } = await import(
        "../../clinic/clinic-pharmacy/models/dispenseLog.model.js"
      );
      if (await DispenseLog.exists({ prescriptionId: rx._id })) {
        return res.status(409).json({
          ok: false,
          error:
            req.t("myClinic.prescription.cannotEditDispensed"),
        });
      }
    } catch (e) {
      // Недоступность журнала аптеки не должна запрещать правку опечатки.
      console.error("[рецепт врача] отпуск не проверен:", e.message);
    }

    const body = req.body || {};
    const next_ = {};
    if (body.items !== undefined) {
      const items = normalizeItems(body.items);
      if (items.length === 0) {
        return res.status(422).json({
          ok: false,
          error: req.t("myClinic.prescription.innRequired"),
        });
      }
      next_.items = items;
    }
    if (body.diagnosis !== undefined) {
      next_.diagnosis = body.diagnosis
        ? {
            code: (body.diagnosis.code || "").trim(),
            codeTitle: (body.diagnosis.codeTitle || "").trim(),
            text: encryptPHI((body.diagnosis.text || "").trim()),
          }
        : { code: "", codeTitle: "", text: "" };
    }
    if (body.generalNotes !== undefined) {
      next_.generalNotes = encryptPHI(String(body.generalNotes || "").trim());
    }
    if (body.substitutionAllowed !== undefined) {
      next_.substitutionAllowed =
        typeof body.substitutionAllowed === "boolean"
          ? body.substitutionAllowed
          : null;
    }
    if (body.refills !== undefined) next_.refills = normalizeRefills(body.refills);
    if (body.validUntil !== undefined) {
      next_.validUntil = normalizeValidUntil(body.validUntil);
    }

    const now = new Date();
    let changed = 0;
    for (const field of Object.keys(next_)) {
      const oldRaw = rx.get(field);
      const oldPlain =
        oldRaw && typeof oldRaw.toObject === "function"
          ? oldRaw.toObject()
          : oldRaw;
      // Сравниваем по содержимому: сабдокумент и обычный объект не равны
      // никогда, и в истории оказалась бы правка, которой не было.
      if (JSON.stringify(oldPlain ?? null) === JSON.stringify(next_[field] ?? null))
        continue;
      rx.history.push({
        updatedBy: userId,
        updatedAt: now,
        changes: { field, oldValue: oldPlain, newValue: next_[field] },
      });
      rx.set(field, next_[field]);
      changed += 1;
    }

    if (changed > 0) await rx.save();
    return res.json({ ok: true, prescription: toApi(rx.toObject()) });
  } catch (err) {
    return next ? next(err) : res.status(500).json({ ok: false });
  }
}

// ── Бланк ───────────────────────────────────────────────────────────────
export async function doctorPrescriptionPdf(req, res, next) {
  try {
    const userId = req.user?.userId || req.session?.userId;
    if (!userId) {
      return res.status(401).json({ ok: false, error: req.t("myClinic.auth.unauthorized") });
    }
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ ok: false, error: req.t("myClinic.validation.invalidIdFormat") });
    }

    const rx = await Prescription.findById(req.params.id).lean();
    if (!rx) {
      return res.status(404).json({ ok: false, error: req.t("myClinic.prescription.notFound") });
    }
    // Печатать может только тот, кто выписал: рецепт — документ с именем.
    if (String(rx.createdBy || "") !== String(userId)) {
      return res.status(403).json({ ok: false, error: req.t("myClinic.access.denied") });
    }

    // Карта может быть любой из трёх: врач печатает и свой рецепт,
    // выписанный в клинике, — под ним стоит его имя.
    let patient;
    if (rx.patientTypeModel === "NewPatientPolyclinic") {
      patient = await NewPatientPolyclinic.findById(rx.patientRef);
    } else if (rx.patientTypeModel === "ClinicPatient") {
      const { default: ClinicPatient } = await import(
        "../../clinic/clinic-patients/models/clinicPatient.model.js"
      );
      // Вне контекста клиники аренда не действует; право на печать уже
      // проверено выше по авторству рецепта.
      patient = await ClinicPatient.findById(rx.patientRef).setOptions({
        skipTenantScope: true,
      });
    } else {
      patient = await DoctorPrivatePatient.findById(rx.patientRef);
    }

    // Шапка бланка. Рецепт, выписанный в клинике, печатается под ЕЁ
    // названием и лицензией — за него отвечает учреждение. Под маркой
    // проекта идёт только то, что врач выписал вне клиники.
    let clinic = null;
    if (rx.createdByClinicId) {
      const { default: Clinic } = await import(
        "../../clinic/clinic-core/models/clinic.model.js"
      );
      clinic = await Clinic.findById(rx.createdByClinicId).lean();
    }
    const { buildPrescriptionPdf } = await import(
      "../../clinic/clinic-medical/pdf/prescriptionPdf.js"
    );

    const pdfBuffer = await buildPrescriptionPdf({
      prescription: {
        ...decryptPrescriptionDoc(rx),
        ...(await resolvePrescriber(rx)),
      },
      // У карт врача аллергии лежат прямо в записи одной строкой, причём
      // поле называется по-разному; у клинической — отдельными записями,
      // и их найдёт сам сборщик.
      patient: await buildPatientForPdf(
        patient,
        rx.patientTypeModel === "ClinicPatient"
          ? undefined
          : {
              allergies:
                patient?.medicalProfile?.allergies || patient?.allergies || "",
            },
      ),
      clinic,
      lang: req.query?.lang || "ru",
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="prescription-${rx._id}.pdf"`,
    );
    return res.status(200).send(pdfBuffer);
  } catch (err) {
    return next ? next(err) : res.status(500).json({ ok: false });
  }
}
