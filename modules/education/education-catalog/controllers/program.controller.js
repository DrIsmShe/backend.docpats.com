// server/modules/education/education-catalog/controllers/program.controller.js
//
// HTTP-слой каталога программ. Тонкий: разбор запроса → сервис → ответ.

import { asyncHandler } from "../../../../common/middlewares/errorHandler.js";
import { ValidationError } from "../../../../common/utils/errors.js";
import {
  createProgram,
  listPrograms,
  listCountries,
  getProgramById,
  getProgramByCode,
  updateProgram,
  archiveProgram,
  deleteProgram,
  getProgramBlocks,
} from "../services/program.service.js";
import {
  createProgramSchema,
  updateProgramSchema,
  listProgramsQuerySchema,
} from "../validators/program.schemas.js";

function throwZod(parsed) {
  throw new ValidationError("Validation failed", {
    issues: parsed.error.issues.map((i) => ({
      path: i.path,
      message: i.message,
    })),
  });
}

export const createProgramController = asyncHandler(async (req, res) => {
  const parsed = createProgramSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);

  const program = await createProgram({
    ...parsed.data,
    actorId: req.educationActor?.userId ?? null,
  });
  res.status(201).json({ program });
});

export const listProgramsController = asyncHandler(async (req, res) => {
  const parsed = listProgramsQuerySchema.safeParse(req.query);
  if (!parsed.success) throwZod(parsed);

  // scope=all и scope=clinic доступны только авторам каталога — учащийся
  // не должен видеть чужие черновики и приватные программы клиник.
  const filters = { ...parsed.data };
  const role = req.educationActor?.role;
  if (filters.scope && filters.scope !== "public") {
    if (!["admin", "doctor"].includes(role)) {
      filters.scope = "public";
    }
  }

  const items = await listPrograms(filters);
  res.json({ items, count: items.length });
});

// Навигация витрины «экзамены по странам».
export const listCountriesController = asyncHandler(async (req, res) => {
  const countries = await listCountries();
  res.json({ countries, count: countries.length });
});

export const getProgramController = asyncHandler(async (req, res) => {
  const program = await getProgramById(req.params.id);
  res.json({ program });
});

export const getProgramByCodeController = asyncHandler(async (req, res) => {
  const program = await getProgramByCode(req.params.code);
  res.json({ program });
});

export const updateProgramController = asyncHandler(async (req, res) => {
  const parsed = updateProgramSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);

  const program = await updateProgram(req.params.id, {
    ...parsed.data,
    actorId: req.educationActor?.userId ?? null,
  });
  res.json({ program });
});

export const archiveProgramController = asyncHandler(async (req, res) => {
  const program = await archiveProgram(req.params.id);
  res.json({ program });
});

// Жёсткое удаление вместе с банком вопросов. Блокируется, если по тесту
// уже есть попытки (сервис бросит ConflictError с reason=has_attempts).
export const deleteProgramController = asyncHandler(async (req, res) => {
  // ?force=true — удалить вместе с историей попыток (осознанно, из UI по
  // второму подтверждению). Без него действует защита истории сдач.
  const force = req.query.force === "true";
  const result = await deleteProgram(req.params.id, { force });
  res.json(result);
});

// Блоки теста (деление большого экзамена по blockSize вопросов).
export const getProgramBlocksController = asyncHandler(async (req, res) => {
  const result = await getProgramBlocks(req.params.id, {
    lang: req.query.lang,
  });
  res.json(result);
});
