// ─────────────────────────────────────────────────────────────────────
//   Минимальная проверка «запрос идёт от вошедшего в систему».
//
//   Не подошёл ни один из существующих гардов:
//     • authMiddleware требует req.session.userId и подгружает User — у
//       сотрудника клиники в сессии лежит только employeeId (см.
//       tenantMiddleware), и он бы получал 401 на ровном месте;
//     • requireAuthDoctor сверх того требует роль doctor;
//     • tenantMiddleware тянет за собой ClinicMembership и tenant-контекст,
//       которых у роутов вне клиники нет.
//
//   Здесь нужен только факт аутентификации, без ролей и без похода в базу:
//   что именно можно делать, решают уже конкретные роуты.
// ─────────────────────────────────────────────────────────────────────

export const requireSession = (req, res, next) => {
  const actorId = req.session?.userId || req.session?.employeeId;

  if (!actorId) {
    return res
      .status(401)
      .json({ authenticated: false, message: req.t("app.auth.notAuthorized") });
  }

  next();
};

export default requireSession;
