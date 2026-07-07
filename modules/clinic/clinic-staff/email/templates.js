// modules/clinic/clinic-staff/email/templates.js
//
// i18n email templates for staff invitations and OTP.
// Languages: ru, en, tr, az, ar.
//
// Invitation has TWO variants (see renderInvitationEmail `isExistingWorker`):
//   - new      → recipient has no worker account yet: "accept & complete
//                registration" (they set a password via OTP on the site).
//   - existing → recipient already has a global clinic-worker account:
//                "accept to join this clinic; log in with your existing
//                password" (one click, no new password).

const SUPPORTED_LANGUAGES = ["ru", "en", "tr", "az", "ar"];

function pickLang(lang) {
  return SUPPORTED_LANGUAGES.includes(lang) ? lang : "en";
}

// ─── INVITATION EMAIL ───────────────────────────────────────────

const INVITATION_SUBJECTS = {
  ru: (clinicName) => `Приглашение в клинику ${clinicName} — DocPats`,
  en: (clinicName) => `You're invited to ${clinicName} on DocPats`,
  tr: (clinicName) => `${clinicName} kliniğine davet edildiniz — DocPats`,
  az: (clinicName) => `${clinicName} klinikasına dəvət — DocPats`,
  ar: (clinicName) => `دعوة للانضمام إلى عيادة ${clinicName} — DocPats`,
};

// New worker: accept + complete registration (set password via OTP).
const INVITATION_BODIES = {
  ru: ({ clinicName, role, inviterName, acceptUrl, expiresInDays }) => `
    <div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#1a1a18;">
      <h1 style="font-size:24px;margin:0 0 16px;color:#1a1a18;">Вас пригласили в клинику</h1>
      <p style="font-size:15px;line-height:1.6;margin:0 0 12px;">
        <strong>${inviterName}</strong> приглашает вас присоединиться к клинике
        <strong>${clinicName}</strong> на платформе DocPats в роли
        <strong>${role}</strong>.
      </p>
      <p style="font-size:15px;line-height:1.6;margin:0 0 24px;">
        Чтобы принять приглашение, нажмите на кнопку ниже и завершите регистрацию.
      </p>
      <a href="${acceptUrl}" style="display:inline-block;background:#3d7fff;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
        Принять приглашение
      </a>
      <p style="font-size:13px;color:#64748b;margin:32px 0 0;line-height:1.5;">
        Ссылка действительна ${expiresInDays} дней. Если вы не ожидали это
        приглашение, просто проигнорируйте письмо.
      </p>
    </div>
  `,
  en: ({ clinicName, role, inviterName, acceptUrl, expiresInDays }) => `
    <div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#1a1a18;">
      <h1 style="font-size:24px;margin:0 0 16px;">You've been invited to a clinic</h1>
      <p style="font-size:15px;line-height:1.6;margin:0 0 12px;">
        <strong>${inviterName}</strong> has invited you to join
        <strong>${clinicName}</strong> on DocPats as a
        <strong>${role}</strong>.
      </p>
      <p style="font-size:15px;line-height:1.6;margin:0 0 24px;">
        Click the button below to accept and complete registration.
      </p>
      <a href="${acceptUrl}" style="display:inline-block;background:#3d7fff;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
        Accept Invitation
      </a>
      <p style="font-size:13px;color:#64748b;margin:32px 0 0;line-height:1.5;">
        This link is valid for ${expiresInDays} days. If you didn't expect this
        invitation, you can safely ignore this email.
      </p>
    </div>
  `,
  tr: ({ clinicName, role, inviterName, acceptUrl, expiresInDays }) => `
    <div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#1a1a18;">
      <h1 style="font-size:24px;margin:0 0 16px;">Bir kliniğe davet edildiniz</h1>
      <p style="font-size:15px;line-height:1.6;margin:0 0 12px;">
        <strong>${inviterName}</strong> sizi DocPats üzerinde
        <strong>${clinicName}</strong> kliniğine
        <strong>${role}</strong> olarak davet etti.
      </p>
      <p style="font-size:15px;line-height:1.6;margin:0 0 24px;">
        Daveti kabul etmek ve kaydı tamamlamak için aşağıdaki düğmeye tıklayın.
      </p>
      <a href="${acceptUrl}" style="display:inline-block;background:#3d7fff;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
        Daveti Kabul Et
      </a>
      <p style="font-size:13px;color:#64748b;margin:32px 0 0;line-height:1.5;">
        Bu bağlantı ${expiresInDays} gün geçerlidir. Eğer bu daveti beklemiyorsanız,
        bu e-postayı yok sayabilirsiniz.
      </p>
    </div>
  `,
  az: ({ clinicName, role, inviterName, acceptUrl, expiresInDays }) => `
    <div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#1a1a18;">
      <h1 style="font-size:24px;margin:0 0 16px;">Sizi klinikaya dəvət etdilər</h1>
      <p style="font-size:15px;line-height:1.6;margin:0 0 12px;">
        <strong>${inviterName}</strong> sizi DocPats platformasında
        <strong>${clinicName}</strong> klinikasına
        <strong>${role}</strong> kimi dəvət etdi.
      </p>
      <p style="font-size:15px;line-height:1.6;margin:0 0 24px;">
        Dəvəti qəbul etmək və qeydiyyatı tamamlamaq üçün aşağıdakı düyməyə klikləyin.
      </p>
      <a href="${acceptUrl}" style="display:inline-block;background:#3d7fff;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
        Dəvəti Qəbul Et
      </a>
      <p style="font-size:13px;color:#64748b;margin:32px 0 0;line-height:1.5;">
        Bu link ${expiresInDays} gün etibarlıdır. Əgər bu dəvəti gözləmirdinizsə,
        bu məktubu nəzərə almaya bilərsiniz.
      </p>
    </div>
  `,
  ar: ({ clinicName, role, inviterName, acceptUrl, expiresInDays }) => `
    <div dir="rtl" style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#1a1a18;">
      <h1 style="font-size:24px;margin:0 0 16px;">تمت دعوتك إلى عيادة</h1>
      <p style="font-size:15px;line-height:1.6;margin:0 0 12px;">
        قام <strong>${inviterName}</strong> بدعوتك للانضمام إلى عيادة
        <strong>${clinicName}</strong> على منصة DocPats بصفة
        <strong>${role}</strong>.
      </p>
      <p style="font-size:15px;line-height:1.6;margin:0 0 24px;">
        انقر فوق الزر أدناه لقبول الدعوة وإكمال التسجيل.
      </p>
      <a href="${acceptUrl}" style="display:inline-block;background:#3d7fff;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
        قبول الدعوة
      </a>
      <p style="font-size:13px;color:#64748b;margin:32px 0 0;line-height:1.5;">
        هذا الرابط صالح لمدة ${expiresInDays} أيام. إذا لم تكن تتوقع هذه الدعوة،
        يمكنك تجاهل هذا البريد.
      </p>
    </div>
  `,
};

// Existing worker: they already have a global clinic-worker account.
// One-click consent; log in with the existing password (no new registration).
const INVITATION_BODIES_EXISTING = {
  ru: ({ clinicName, role, inviterName, acceptUrl, expiresInDays }) => `
    <div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#1a1a18;">
      <h1 style="font-size:24px;margin:0 0 16px;color:#1a1a18;">Приглашение присоединиться к клинике</h1>
      <p style="font-size:15px;line-height:1.6;margin:0 0 12px;">
        <strong>${inviterName}</strong> приглашает вас работать в клинике
        <strong>${clinicName}</strong> на платформе DocPats в роли
        <strong>${role}</strong>.
      </p>
      <p style="font-size:15px;line-height:1.6;margin:0 0 24px;">
        У вас уже есть учётная запись сотрудника DocPats. Нажмите кнопку ниже,
        чтобы подтвердить — новый пароль задавать не нужно, вы войдёте со своим
        текущим паролем.
      </p>
      <a href="${acceptUrl}" style="display:inline-block;background:#3d7fff;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
        Принять приглашение
      </a>
      <p style="font-size:13px;color:#64748b;margin:32px 0 0;line-height:1.5;">
        Ссылка действительна ${expiresInDays} дней. Если вы не ожидали это
        приглашение, просто проигнорируйте письмо.
      </p>
    </div>
  `,
  en: ({ clinicName, role, inviterName, acceptUrl, expiresInDays }) => `
    <div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#1a1a18;">
      <h1 style="font-size:24px;margin:0 0 16px;">Invitation to join a clinic</h1>
      <p style="font-size:15px;line-height:1.6;margin:0 0 12px;">
        <strong>${inviterName}</strong> has invited you to work at
        <strong>${clinicName}</strong> on DocPats as a
        <strong>${role}</strong>.
      </p>
      <p style="font-size:15px;line-height:1.6;margin:0 0 24px;">
        You already have a DocPats worker account. Click below to accept — no
        new password needed, just sign in with your existing one.
      </p>
      <a href="${acceptUrl}" style="display:inline-block;background:#3d7fff;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
        Accept Invitation
      </a>
      <p style="font-size:13px;color:#64748b;margin:32px 0 0;line-height:1.5;">
        This link is valid for ${expiresInDays} days. If you didn't expect this
        invitation, you can safely ignore this email.
      </p>
    </div>
  `,
  tr: ({ clinicName, role, inviterName, acceptUrl, expiresInDays }) => `
    <div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#1a1a18;">
      <h1 style="font-size:24px;margin:0 0 16px;">Bir kliniğe katılma daveti</h1>
      <p style="font-size:15px;line-height:1.6;margin:0 0 12px;">
        <strong>${inviterName}</strong> sizi DocPats üzerinde
        <strong>${clinicName}</strong> kliniğinde
        <strong>${role}</strong> olarak çalışmaya davet etti.
      </p>
      <p style="font-size:15px;line-height:1.6;margin:0 0 24px;">
        Zaten bir DocPats çalışan hesabınız var. Kabul etmek için aşağıya tıklayın —
        yeni parola gerekmez, mevcut parolanızla giriş yaparsınız.
      </p>
      <a href="${acceptUrl}" style="display:inline-block;background:#3d7fff;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
        Daveti Kabul Et
      </a>
      <p style="font-size:13px;color:#64748b;margin:32px 0 0;line-height:1.5;">
        Bu bağlantı ${expiresInDays} gün geçerlidir. Eğer bu daveti beklemiyorsanız,
        bu e-postayı yok sayabilirsiniz.
      </p>
    </div>
  `,
  az: ({ clinicName, role, inviterName, acceptUrl, expiresInDays }) => `
    <div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#1a1a18;">
      <h1 style="font-size:24px;margin:0 0 16px;">Klinikaya qoşulmaq dəvəti</h1>
      <p style="font-size:15px;line-height:1.6;margin:0 0 12px;">
        <strong>${inviterName}</strong> sizi DocPats platformasında
        <strong>${clinicName}</strong> klinikasında
        <strong>${role}</strong> kimi işləməyə dəvət etdi.
      </p>
      <p style="font-size:15px;line-height:1.6;margin:0 0 24px;">
        DocPats-də artıq işçi hesabınız var. Təsdiq etmək üçün aşağıdakı düyməyə
        klikləyin — yeni parol lazım deyil, mövcud parolunuzla daxil olacaqsınız.
      </p>
      <a href="${acceptUrl}" style="display:inline-block;background:#3d7fff;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
        Dəvəti Qəbul Et
      </a>
      <p style="font-size:13px;color:#64748b;margin:32px 0 0;line-height:1.5;">
        Bu link ${expiresInDays} gün etibarlıdır. Əgər bu dəvəti gözləmirdinizsə,
        bu məktubu nəzərə almaya bilərsiniz.
      </p>
    </div>
  `,
  ar: ({ clinicName, role, inviterName, acceptUrl, expiresInDays }) => `
    <div dir="rtl" style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#1a1a18;">
      <h1 style="font-size:24px;margin:0 0 16px;">دعوة للانضمام إلى عيادة</h1>
      <p style="font-size:15px;line-height:1.6;margin:0 0 12px;">
        قام <strong>${inviterName}</strong> بدعوتك للعمل في عيادة
        <strong>${clinicName}</strong> على منصة DocPats بصفة
        <strong>${role}</strong>.
      </p>
      <p style="font-size:15px;line-height:1.6;margin:0 0 24px;">
        لديك بالفعل حساب موظف على DocPats. انقر أدناه للقبول — لا حاجة لكلمة مرور
        جديدة، فقط سجّل الدخول بكلمة المرور الحالية.
      </p>
      <a href="${acceptUrl}" style="display:inline-block;background:#3d7fff;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
        قبول الدعوة
      </a>
      <p style="font-size:13px;color:#64748b;margin:32px 0 0;line-height:1.5;">
        هذا الرابط صالح لمدة ${expiresInDays} أيام. إذا لم تكن تتوقع هذه الدعوة،
        يمكنك تجاهل هذا البريد.
      </p>
    </div>
  `,
};

/**
 * Build invitation email HTML and subject.
 *
 * @param {object} args
 * @param {boolean} [args.isExistingWorker] — true → one-click-consent copy for
 *   a worker who already has a global clinic-worker account.
 */
export function renderInvitationEmail({
  language = "ru",
  clinicName,
  role,
  inviterName,
  acceptUrl,
  expiresInDays = 7,
  isExistingWorker = false,
}) {
  const lang = pickLang(language);
  const bodies = isExistingWorker
    ? INVITATION_BODIES_EXISTING
    : INVITATION_BODIES;
  return {
    subject: INVITATION_SUBJECTS[lang](clinicName),
    htmlContent: bodies[lang]({
      clinicName,
      role,
      inviterName,
      acceptUrl,
      expiresInDays,
    }),
  };
}

// ─── OTP EMAIL ──────────────────────────────────────────────────

const OTP_SUBJECTS = {
  ru: () => "Код подтверждения — DocPats",
  en: () => "Your verification code — DocPats",
  tr: () => "Doğrulama kodunuz — DocPats",
  az: () => "Təsdiq kodu — DocPats",
  ar: () => "رمز التحقق — DocPats",
};

const OTP_BODIES = {
  ru: ({ otp, expiresInMinutes }) => `
    <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#1a1a18;text-align:center;">
      <h1 style="font-size:22px;margin:0 0 16px;">Ваш код подтверждения</h1>
      <p style="font-size:15px;line-height:1.6;margin:0 0 24px;color:#64748b;">
        Введите этот код для завершения регистрации:
      </p>
      <div style="font-size:36px;font-weight:700;letter-spacing:8px;background:#f5f2eb;padding:20px;border-radius:8px;margin:0 0 24px;">
        ${otp}
      </div>
      <p style="font-size:13px;color:#64748b;margin:0;line-height:1.5;">
        Код действителен ${expiresInMinutes} минут. Никому не сообщайте этот код.
      </p>
    </div>
  `,
  en: ({ otp, expiresInMinutes }) => `
    <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#1a1a18;text-align:center;">
      <h1 style="font-size:22px;margin:0 0 16px;">Your verification code</h1>
      <p style="font-size:15px;line-height:1.6;margin:0 0 24px;color:#64748b;">
        Enter this code to complete your registration:
      </p>
      <div style="font-size:36px;font-weight:700;letter-spacing:8px;background:#f5f2eb;padding:20px;border-radius:8px;margin:0 0 24px;">
        ${otp}
      </div>
      <p style="font-size:13px;color:#64748b;margin:0;line-height:1.5;">
        Code valid for ${expiresInMinutes} minutes. Never share this code.
      </p>
    </div>
  `,
  tr: ({ otp, expiresInMinutes }) => `
    <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#1a1a18;text-align:center;">
      <h1 style="font-size:22px;margin:0 0 16px;">Doğrulama Kodunuz</h1>
      <p style="font-size:15px;line-height:1.6;margin:0 0 24px;color:#64748b;">
        Kaydı tamamlamak için bu kodu girin:
      </p>
      <div style="font-size:36px;font-weight:700;letter-spacing:8px;background:#f5f2eb;padding:20px;border-radius:8px;margin:0 0 24px;">
        ${otp}
      </div>
      <p style="font-size:13px;color:#64748b;margin:0;line-height:1.5;">
        Kod ${expiresInMinutes} dakika geçerlidir. Bu kodu kimseyle paylaşmayın.
      </p>
    </div>
  `,
  az: ({ otp, expiresInMinutes }) => `
    <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#1a1a18;text-align:center;">
      <h1 style="font-size:22px;margin:0 0 16px;">Təsdiq kodunuz</h1>
      <p style="font-size:15px;line-height:1.6;margin:0 0 24px;color:#64748b;">
        Qeydiyyatı tamamlamaq üçün bu kodu daxil edin:
      </p>
      <div style="font-size:36px;font-weight:700;letter-spacing:8px;background:#f5f2eb;padding:20px;border-radius:8px;margin:0 0 24px;">
        ${otp}
      </div>
      <p style="font-size:13px;color:#64748b;margin:0;line-height:1.5;">
        Kod ${expiresInMinutes} dəqiqə etibarlıdır. Bu kodu heç kimlə paylaşmayın.
      </p>
    </div>
  `,
  ar: ({ otp, expiresInMinutes }) => `
    <div dir="rtl" style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#1a1a18;text-align:center;">
      <h1 style="font-size:22px;margin:0 0 16px;">رمز التحقق الخاص بك</h1>
      <p style="font-size:15px;line-height:1.6;margin:0 0 24px;color:#64748b;">
        أدخل هذا الرمز لإكمال التسجيل:
      </p>
      <div style="font-size:36px;font-weight:700;letter-spacing:8px;background:#f5f2eb;padding:20px;border-radius:8px;margin:0 0 24px;">
        ${otp}
      </div>
      <p style="font-size:13px;color:#64748b;margin:0;line-height:1.5;">
        الرمز صالح لمدة ${expiresInMinutes} دقيقة. لا تشارك هذا الرمز مع أي شخص.
      </p>
    </div>
  `,
};

/**
 * Build OTP email HTML and subject.
 */
export function renderOtpEmail({
  language = "ru",
  otp,
  expiresInMinutes = 10,
}) {
  const lang = pickLang(language);
  return {
    subject: OTP_SUBJECTS[lang](),
    htmlContent: OTP_BODIES[lang]({ otp, expiresInMinutes }),
  };
}
