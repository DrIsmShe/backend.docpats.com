// server/jobs/expireConsentRequests.cron.js
//
// Cron job: ежедневно отмечает истёкшие ConsentRequest-ы.
//
// Sprint 3.2 (Pull Consent, 31 May 2026).
//
// Schedule: каждый день в 04:00 UTC (через node-cron).
// Action: status="pending" + expiresAt<now → status="expired" + respondedAt=now.
//
// Запускается из index.js в bootstrap() после успешного MongoDB connect.
//
// ─────────────────────────────────────────────────────────────────────────────
//  ЗАЧЕМ В 04:00 UTC
// ─────────────────────────────────────────────────────────────────────────────
//
// 04:00 UTC = 08:00 Баку, 07:00 Москва, 06:00 Стамбул.
// Это окно после ночных backup-окон, до начала рабочего дня в клиниках.
// findActive() в любой момент игнорирует expired по дате — крон нужен только
// для того чтобы статус был правильным в UI/audit log.
//
// ─────────────────────────────────────────────────────────────────────────────

import cron from "node-cron";
import consentRequestService from "../modules/clinic/clinic-consent/services/consentRequest.service.js";

const SCHEDULE = "0 4 * * *"; // ежедневно в 04:00 UTC

export function startExpireConsentRequestsCron() {
  cron.schedule(SCHEDULE, async () => {
    try {
      const expiredCount = await consentRequestService.expireStaleRequests();
      if (expiredCount > 0) {
        console.log(
          `🕓 [consent-requests] Expired ${expiredCount} stale pending requests`,
        );
      }
    } catch (err) {
      console.error("❌ [consent-requests] Cron expire failed:", err.message);
    }
  });
}

export default startExpireConsentRequestsCron;
