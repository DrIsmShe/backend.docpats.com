// server/modules/procedures/procedure.mapper.js
//
// Что уходит наружу. Whitelist, а не «весь документ минус пара полей»:
// при добавлении поля в модель безопасное поведение по умолчанию — не
// отдавать его, а не отдать случайно.
//
// notesDoctor не отдаётся НИКОГДА в списках и отдаётся только владельцу
// записи в детальном виде: это заметка врача о пациенте, а не описание
// вмешательства для пациента.

export function toProcedureDTO(doc, { patientName = null, forDoctor = true } = {}) {
  if (!doc) return null;
  const d = typeof doc.toObject === "function" ? doc.toObject() : doc;

  return {
    _id: String(d._id),
    kind: d.kind,
    title: d.title,
    code: d.code || null,
    startsAt: d.startsAt,
    endsAt: d.endsAt,
    durationMin: Math.round((new Date(d.endsAt) - new Date(d.startsAt)) / 60000),
    place: d.place || null,
    preparation: d.preparation || null,
    fasting: Boolean(d.fasting),
    anesthesia: d.anesthesia || "none",
    status: d.status,
    cancelReason: d.cancelReason || null,
    postponedToId: d.postponedToId ? String(d.postponedToId) : null,
    isArchived: Boolean(d.isArchived),
    createdAt: d.createdAt,
    patient: {
      name: patientName,
      // Какая из двух ссылок сработала — нужно интерфейсу, чтобы открыть
      // правильную карточку. Сам id отдаём только врачу.
      kind: d.patientId ? "registered" : "private",
      id: forDoctor
        ? String(d.patientId || d.privatePatientId || "")
        : undefined,
    },
    ...(forDoctor ? { notesDoctor: d.notesDoctor || null } : {}),
  };
}

export default toProcedureDTO;
