// modules/admin/controllers/platformClinicEmployee.controller.js
//
// Platform-owner controller for deleting a global ClinicEmployee identity.
// Mounted under the admin router behind requireAdmin (User.role === "admin").
//
// A clinic can only fire (end its membership); only the platform owner can
// delete the identity itself. Deletion is soft (isPlatformDeleted) and also
// removes the worker from every clinic + revokes pending invites.

import { platformDeleteEmployee } from "../../clinic/clinic-staff/services/platformClinicEmployee.service.js";

// DELETE /clinic-workers/:employeeId
export async function deleteClinicWorker(req, res, next) {
  try {
    // requireAdmin has already verified the platform owner and set req.userId.
    const actorUserId = req.userId || req.session?.userId || null;
    const { employeeId } = req.params;

    const result = await platformDeleteEmployee(employeeId, actorUserId);

    res.json({
      success: true,
      ...result,
    });
  } catch (err) {
    next(err);
  }
}
