// server/modules/scribe/services/scribeDraft.service.js
//
// Завершение приёма: диалог → черновик записи.
//
// Черновик НЕ создаётся автоматически в карте. Он возвращается врачу на
// экран, и в карту попадает только после того, как врач нажал
// «Сохранить». Причина та же, по которой запись всегда draft: под
// выводом модели не должно оказаться подписи человека, который его не
// читал. Разница между «врач принял черновик» и «система записала за
// врача» — это разница между инструментом и подлогом.

import ScribeSession from "../models/scribeSession.model.js";
import { dialogueText } from "./scribe.service.js";
import { structureDialogue } from "../ai/dialogueStructurer.js";
import {
  NotFoundError,
  ForbiddenError,
  ValidationError,
} from "../../../common/utils/errors.js";
import logger from "../../../common/logger.js";

const log = logger.child({ module: "scribe/draft" });

/**
 * Врач завершает запись и получает черновик.
 */
export async function finishSession({ sessionId, doctorId }) {
  const session = await ScribeSession.findById(sessionId);
  if (!session) throw new NotFoundError("Сеанс записи не найден");
  if (String(session.doctorId) !== String(doctorId)) {
    throw new ForbiddenError("Завершить запись может только врач приёма");
  }

  if (session.status === "declined") {
    throw new ValidationError("Пациент не дал согласия на запись");
  }
  if (!session.segments.length) {
    // Пустая расшифровка — это не ошибка модели, а отсутствие звука:
    // микрофон выключен, согласие отозвано, приём прошёл молча.
    session.status = "failed";
    session.error = "Речь не распознана: записи разговора нет";
    session.finishedAt = new Date();
    await session.save();
    throw new ValidationError(
      "Речь не распознана. Проверьте, что микрофон был включён, " +
        "и заполните запись вручную.",
    );
  }

  session.status = "finishing";
  await session.save();

  try {
    const dialogue = dialogueText(session);
    const draft = await structureDialogue({ dialogue });

    session.status = "ready";
    session.finishedAt = new Date();
    await session.save();

    log.info(
      {
        sessionId: String(session._id),
        segments: session.segments.length,
        notHeard: draft.notHeard.length,
      },
      "Черновик приёма собран",
    );

    return {
      sessionId: String(session._id),
      draft,
      // Расшифровку отдаём вместе с черновиком: врач должен иметь
      // возможность свериться с тем, что было сказано, не выходя с
      // экрана. Черновик без первоисточника нечем проверить.
      dialogue: session.segments
        .slice()
        .sort((a, b) => a.startSec - b.startSec)
        .map((s) => ({ speaker: s.speaker, text: s.text })),
      seconds: session.participants.reduce((a, p) => a + p.seconds, 0),
    };
  } catch (err) {
    session.status = "failed";
    session.error = String(err.message || err).slice(0, 500);
    session.finishedAt = new Date();
    await session.save();
    throw err;
  }
}

export default { finishSession };
