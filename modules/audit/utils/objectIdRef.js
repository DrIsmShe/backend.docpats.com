// server/modules/audit/utils/objectIdRef.js
//
// Поля resourceId, resourceOwnerId и caseId в модели аудита объявлены как
// ObjectId. Всё, что туда не помещается, роняет ВСЮ запись целиком:
// Mongoose не сохраняет документ, у которого не привёлся хотя бы один путь.
//
// А не помещается туда многое, и это не ошибка вызывающего кода.
// Идентификатор звонка — строка call_<ts>_<rnd>. Имя комнаты — строка.
// Такие значения приходили в аудит как есть, приведение падало,
// recordActionAsync ошибку глотал (он fire-and-forget по замыслу), и
// записи просто не появлялось. Снаружи всё выглядело исправно, а
// канонический HIPAA-журнал звонков оставался пуст.
//
// Поэтому развилка, а не приведение: похоже на ObjectId — идёт в поле;
// не похоже — идёт в metadata отдельным ключом, и запись всё равно
// пишется. Потерять идентификатор плохо, потерять из-за него весь след
// обращения к PHI — несравнимо хуже.
//
// Идентификаторы — структурные данные, и metadata им подходит: правило
// «никакого PHI в metadata» они не нарушают.

// Ровно 24 шестнадцатеричных знака — своей проверкой, а не
// mongoose.isValidObjectId. Сегодня (Mongoose 8) они совпадают, но
// раньше isValidObjectId принимал ещё и любую 12-символьную строку,
// превращая её в ObjectId, не относящийся ни к чему. Правило аудита не
// должно менять смысл при обновлении зависимости: запись, указывающая
// не на тот объект, хуже записи, честно признающей, что объект назван
// строкой.
const OBJECT_ID_RE = /^[a-f\d]{24}$/i;

/** Значение, пригодное для поля-ObjectId, иначе null. */
export function asObjectId(val) {
  if (val === null || val === undefined) return null;
  const str = typeof val === "string" ? val : String(val);
  return OBJECT_ID_RE.test(str) ? str : null;
}

/**
 * Разложить идентификаторы на те, что лягут в поля, и те, что уйдут в
 * metadata. Возвращает { ids, refs } — refs пуст, когда всё поместилось.
 */
export function splitRefs(pairs) {
  const ids = {};
  const refs = {};
  for (const [field, val] of Object.entries(pairs)) {
    const id = asObjectId(val);
    ids[field] = id;
    if (val !== null && val !== undefined && val !== "" && !id) {
      refs[`${field.replace(/Id$/, "")}Ref`] = String(val);
    }
  }
  return { ids, refs };
}

export default { asObjectId, splitRefs };
