// modules/clinic/clinic-staff/email/passwordResetTemplate.js
//
// Письмо восстановления пароля сотрудника клиники. 5 языков: ru, en, tr, az, ar.
//
// В письме СРАЗУ ОБЕ половины: ссылка (с подписанным токеном) и 6-значный код.
// По отдельности они бесполезны — проверку см. в employeePassword.service.js.
// Отдельный файл, чтобы не раздувать templates.js (там приглашения и OTP).

const SUPPORTED_LANGUAGES = ["ru", "en", "tr", "az", "ar"];

function pickLang(lang) {
  return SUPPORTED_LANGUAGES.includes(lang) ? lang : "en";
}

const SUBJECTS = {
  ru: () => "Восстановление пароля — DocPats",
  en: () => "Reset your password — DocPats",
  tr: () => "Şifrenizi sıfırlayın — DocPats",
  az: () => "Parolun bərpası — DocPats",
  ar: () => "إعادة تعيين كلمة المرور — DocPats",
};

const BODIES = {
  ru: ({ firstName, otp, resetUrl, expiresInMinutes }) => `
    <div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#1a1a18;">
      <h1 style="font-size:24px;margin:0 0 16px;">Восстановление пароля</h1>
      <p style="font-size:15px;line-height:1.6;margin:0 0 12px;">
        ${firstName ? `${firstName}, п` : "П"}оступил запрос на смену пароля от вашей
        рабочей учётной записи DocPats.
      </p>
      <p style="font-size:15px;line-height:1.6;margin:0 0 24px;">
        Нажмите кнопку ниже и введите код подтверждения — понадобится и то, и другое.
      </p>
      <a href="${resetUrl}" style="display:inline-block;background:#3d7fff;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
        Задать новый пароль
      </a>
      <p style="font-size:15px;line-height:1.6;margin:28px 0 8px;color:#64748b;">Код подтверждения:</p>
      <div style="font-size:32px;font-weight:700;letter-spacing:8px;background:#f5f2eb;padding:18px;border-radius:8px;text-align:center;margin:0 0 24px;">
        ${otp}
      </div>
      <p style="font-size:13px;color:#64748b;margin:0;line-height:1.5;">
        Ссылка и код действительны ${expiresInMinutes} минут. Никому не сообщайте код.
        Если вы не запрашивали смену пароля — просто проигнорируйте это письмо,
        текущий пароль останется прежним.
      </p>
    </div>
  `,
  en: ({ firstName, otp, resetUrl, expiresInMinutes }) => `
    <div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#1a1a18;">
      <h1 style="font-size:24px;margin:0 0 16px;">Reset your password</h1>
      <p style="font-size:15px;line-height:1.6;margin:0 0 12px;">
        ${firstName ? `${firstName}, we` : "We"} received a request to reset the password
        for your DocPats staff account.
      </p>
      <p style="font-size:15px;line-height:1.6;margin:0 0 24px;">
        Click the button below and enter the confirmation code — you need both.
      </p>
      <a href="${resetUrl}" style="display:inline-block;background:#3d7fff;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
        Set a new password
      </a>
      <p style="font-size:15px;line-height:1.6;margin:28px 0 8px;color:#64748b;">Confirmation code:</p>
      <div style="font-size:32px;font-weight:700;letter-spacing:8px;background:#f5f2eb;padding:18px;border-radius:8px;text-align:center;margin:0 0 24px;">
        ${otp}
      </div>
      <p style="font-size:13px;color:#64748b;margin:0;line-height:1.5;">
        The link and code are valid for ${expiresInMinutes} minutes. Never share the code.
        If you did not request this, ignore this email — your password stays unchanged.
      </p>
    </div>
  `,
  tr: ({ firstName, otp, resetUrl, expiresInMinutes }) => `
    <div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#1a1a18;">
      <h1 style="font-size:24px;margin:0 0 16px;">Şifre sıfırlama</h1>
      <p style="font-size:15px;line-height:1.6;margin:0 0 12px;">
        ${firstName ? `${firstName}, D` : "D"}ocPats çalışan hesabınız için şifre sıfırlama
        talebi aldık.
      </p>
      <p style="font-size:15px;line-height:1.6;margin:0 0 24px;">
        Aşağıdaki düğmeye tıklayın ve doğrulama kodunu girin — ikisi de gereklidir.
      </p>
      <a href="${resetUrl}" style="display:inline-block;background:#3d7fff;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
        Yeni şifre belirle
      </a>
      <p style="font-size:15px;line-height:1.6;margin:28px 0 8px;color:#64748b;">Doğrulama kodu:</p>
      <div style="font-size:32px;font-weight:700;letter-spacing:8px;background:#f5f2eb;padding:18px;border-radius:8px;text-align:center;margin:0 0 24px;">
        ${otp}
      </div>
      <p style="font-size:13px;color:#64748b;margin:0;line-height:1.5;">
        Bağlantı ve kod ${expiresInMinutes} dakika geçerlidir. Kodu kimseyle paylaşmayın.
        Bu talebi siz yapmadıysanız bu e-postayı yok sayın — şifreniz değişmez.
      </p>
    </div>
  `,
  az: ({ firstName, otp, resetUrl, expiresInMinutes }) => `
    <div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#1a1a18;">
      <h1 style="font-size:24px;margin:0 0 16px;">Parolun bərpası</h1>
      <p style="font-size:15px;line-height:1.6;margin:0 0 12px;">
        ${firstName ? `${firstName}, D` : "D"}ocPats işçi hesabınız üçün parolun dəyişdirilməsi
        sorğusu alındı.
      </p>
      <p style="font-size:15px;line-height:1.6;margin:0 0 24px;">
        Aşağıdakı düyməyə klikləyin və təsdiq kodunu daxil edin — hər ikisi lazımdır.
      </p>
      <a href="${resetUrl}" style="display:inline-block;background:#3d7fff;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
        Yeni parol təyin et
      </a>
      <p style="font-size:15px;line-height:1.6;margin:28px 0 8px;color:#64748b;">Təsdiq kodu:</p>
      <div style="font-size:32px;font-weight:700;letter-spacing:8px;background:#f5f2eb;padding:18px;border-radius:8px;text-align:center;margin:0 0 24px;">
        ${otp}
      </div>
      <p style="font-size:13px;color:#64748b;margin:0;line-height:1.5;">
        Link və kod ${expiresInMinutes} dəqiqə etibarlıdır. Kodu heç kimlə paylaşmayın.
        Bu sorğunu siz göndərməmisinizsə, məktubu nəzərə almayın — parolunuz dəyişməyəcək.
      </p>
    </div>
  `,
  ar: ({ firstName, otp, resetUrl, expiresInMinutes }) => `
    <div dir="rtl" style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#1a1a18;">
      <h1 style="font-size:24px;margin:0 0 16px;">إعادة تعيين كلمة المرور</h1>
      <p style="font-size:15px;line-height:1.6;margin:0 0 12px;">
        ${firstName ? `${firstName}، ` : ""}تلقينا طلبًا لإعادة تعيين كلمة مرور حساب الموظف الخاص بك على DocPats.
      </p>
      <p style="font-size:15px;line-height:1.6;margin:0 0 24px;">
        اضغط على الزر أدناه وأدخل رمز التحقق — كلاهما مطلوب.
      </p>
      <a href="${resetUrl}" style="display:inline-block;background:#3d7fff;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
        تعيين كلمة مرور جديدة
      </a>
      <p style="font-size:15px;line-height:1.6;margin:28px 0 8px;color:#64748b;">رمز التحقق:</p>
      <div style="font-size:32px;font-weight:700;letter-spacing:8px;background:#f5f2eb;padding:18px;border-radius:8px;text-align:center;margin:0 0 24px;">
        ${otp}
      </div>
      <p style="font-size:13px;color:#64748b;margin:0;line-height:1.5;">
        الرابط والرمز صالحان لمدة ${expiresInMinutes} دقيقة. لا تشارك الرمز مع أحد.
        إذا لم تطلب ذلك، تجاهل هذه الرسالة — لن تتغير كلمة مرورك.
      </p>
    </div>
  `,
};

/**
 * Собрать письмо восстановления пароля (ссылка + код в одном сообщении).
 *
 * @param {object} args
 * @param {string} [args.language]        — ru | en | tr | az | ar
 * @param {string} [args.firstName]       — расшифрованное имя, только для приветствия
 * @param {string} args.otp               — 6-значный код
 * @param {string} args.resetUrl          — ссылка с подписанным токеном
 * @param {number} [args.expiresInMinutes]
 * @returns {{subject: string, htmlContent: string}}
 */
export function renderPasswordResetEmail({
  language = "ru",
  firstName = "",
  otp,
  resetUrl,
  expiresInMinutes = 30,
}) {
  const lang = pickLang(language);
  return {
    subject: SUBJECTS[lang](),
    htmlContent: BODIES[lang]({ firstName, otp, resetUrl, expiresInMinutes }),
  };
}
