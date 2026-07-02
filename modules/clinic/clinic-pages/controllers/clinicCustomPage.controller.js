// server/modules/clinic/clinic-pages/controllers/clinicCustomPage.controller.js
//
// Контроллеры CRUD кастомных страниц. Запись — под can("clinic","write").
// Чтение списка/одной — для членов клиники (роут под tenantMiddleware).

import * as service from "../services/clinicCustomPage.service.js";
import {
  createCustomPageSchema,
  updateCustomPageSchema,
  publishCustomPageSchema,
} from "../validators/clinicCustomPage.schemas.js";
import { ForbiddenError } from "../../../../common/utils/errors.js";
import { can } from "../../../../common/auth/can.js";

function assertCanWrite() {
  if (!can("clinic", "write")) {
    throw new ForbiddenError("clinic.write permission required");
  }
}

/** GET /api/v1/clinic/pages?status= */
export async function listPages(req, res, next) {
  try {
    const items = await service.listCustomPages({
      status: req.query.status,
    });
    res.json({
      items: items.map((p) => ({
        id: String(p._id),
        slug: p.slug,
        title: p.title,
        status: p.status,
        order: p.order ?? 0,
        parentId: p.parentId ? String(p.parentId) : null,
        blockCount: Array.isArray(p.layout?.blocks)
          ? p.layout.blocks.length
          : 0,
        updatedAt: p.updatedAt,
      })),
    });
  } catch (err) {
    next(err);
  }
}

/** GET /api/v1/clinic/pages/:id */
export async function getPage(req, res, next) {
  try {
    const page = await service.getCustomPage(req.params.id);
    res.json({ page });
  } catch (err) {
    next(err);
  }
}

/** POST /api/v1/clinic/pages */
export async function createPage(req, res, next) {
  try {
    assertCanWrite();
    const data = createCustomPageSchema.parse(req.body);
    const page = await service.createCustomPage(data);
    res.status(201).json({ page });
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/v1/clinic/pages/:id */
export async function updatePage(req, res, next) {
  try {
    assertCanWrite();
    const updates = updateCustomPageSchema.parse(req.body);
    const page = await service.updateCustomPage(req.params.id, updates);
    res.json({ page });
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/v1/clinic/pages/:id/publish */
export async function publishPage(req, res, next) {
  try {
    assertCanWrite();
    const { status } = publishCustomPageSchema.parse(req.body);
    const page = await service.setCustomPagePublished(req.params.id, status);
    res.json({ page });
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/v1/clinic/pages/:id */
export async function deletePage(req, res, next) {
  try {
    assertCanWrite();
    const result = await service.removeCustomPage(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
