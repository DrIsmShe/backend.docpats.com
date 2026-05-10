// modules/clinic/clinic-staff/controllers/employeeAuth.controller.js
//
// HTTP controllers for ClinicEmployee authentication.
// Public: login. Authenticated: logout, me.

import * as authService from "../services/employeeAuth.service.js";
import { loginSchema } from "../validators/employeeAuth.schemas.js";
import {
  ValidationError,
  UnauthorizedError,
} from "../../../../common/utils/errors.js";

function parseOrThrow(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ValidationError("Invalid input", { issues: result.error.issues });
  }
  return result.data;
}

// ─── POST /login ──────────────────────────────────────────────

export async function login(req, res, next) {
  try {
    const data = parseOrThrow(loginSchema, req.body);

    const { employee, clinic, membership } = await authService.loginEmployee({
      email: data.email,
      password: data.password,
    });

    // Establish session — clear any previous user/employee identity
    if (req.session) {
      // Regenerate the session id to prevent fixation attacks
      await new Promise((resolve, reject) => {
        req.session.regenerate((err) => (err ? reject(err) : resolve()));
      });

      req.session.employeeId = String(employee._id);
      // Make sure no stale userId leaks into the new session
      delete req.session.userId;

      await new Promise((resolve, reject) => {
        req.session.save((err) => (err ? reject(err) : resolve()));
      });
    }

    res.json({
      employee: authService.employeeToDTO(employee),
      clinic: {
        _id: String(clinic._id),
        name: clinic.name,
        slug: clinic.slug,
        tier: clinic.tier,
      },
      role: membership.role,
    });
  } catch (err) {
    next(err);
  }
}

// ─── POST /logout ─────────────────────────────────────────────

export async function logout(req, res, next) {
  try {
    if (!req.session) {
      return res.json({ success: true });
    }
    await new Promise((resolve, reject) => {
      req.session.destroy((err) => (err ? reject(err) : resolve()));
    });
    res.clearCookie("connect.sid"); // best-effort
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

// ─── GET /me ──────────────────────────────────────────────────

export async function me(req, res, next) {
  try {
    const employeeId = req.session?.employeeId;
    if (!employeeId) {
      throw new UnauthorizedError("Not authenticated");
    }

    const { employee, clinic, membership } =
      await authService.getEmployeeWithClinic(employeeId);

    res.json({
      employee: authService.employeeToDTO(employee),
      clinic: {
        _id: String(clinic._id),
        name: clinic.name,
        slug: clinic.slug,
        tier: clinic.tier,
      },
      role: membership.role,
    });
  } catch (err) {
    next(err);
  }
}
