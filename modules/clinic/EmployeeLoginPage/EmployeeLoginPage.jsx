// client/src/pages/clinic/EmployeeLoginPage/EmployeeLoginPage.jsx
//
// Public page: ClinicEmployee login.
// - Pre-fills email if redirected from InvitationAcceptPage success.
// - Shows a one-time success banner after fresh registration.
// - On successful login, redirects to /clinic/employee.

import React, { useState, useEffect } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { employeeLogin } from "../../../api/clinic";
import LanguageSwitcher from "../../../components/LanguageSwitcher";
import "./employeeLoginPage.css";

export default function EmployeeLoginPage() {
  const { t, i18n } = useTranslation("clinic");
  const navigate = useNavigate();
  const location = useLocation();

  // Email pre-fill from /clinic/invitations/accept success redirect
  const initialEmail = location.state?.email || "";
  const justRegistered = !!location.state?.email;

  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [showRegisteredBanner, setShowRegisteredBanner] =
    useState(justRegistered);

  // ─── RTL support ───
  useEffect(() => {
    const lang = (i18n.language || "en").split("-")[0];
    document.documentElement.setAttribute("dir", lang === "ar" ? "rtl" : "ltr");
    document.documentElement.setAttribute("lang", lang);
  }, [i18n.language]);

  function validate() {
    const errors = {};
    if (!email.trim()) {
      errors.email = t("employeeLogin.errors.emailRequired");
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = t("employeeLogin.errors.emailInvalid");
    }
    if (!password) {
      errors.password = t("employeeLogin.errors.passwordRequired");
    }
    return errors;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setShowRegisteredBanner(false);

    const v = validate();
    if (Object.keys(v).length > 0) {
      setFieldErrors(v);
      return;
    }
    setFieldErrors({});

    setSubmitting(true);
    try {
      await employeeLogin({
        email: email.trim().toLowerCase(),
        password,
      });
      navigate("/clinic/employee", { replace: true });
    } catch (err) {
      const status = err.response?.status;
      const data = err.response?.data;

      if (status === 400 && data?.details?.issues) {
        const fe = {};
        for (const issue of data.details.issues) {
          const field = issue.path?.[0];
          if (field) fe[field] = issue.message;
        }
        setFieldErrors(fe);
        setError(t("employeeLogin.errors.fixErrors"));
      } else if (status === 401) {
        const msg = data?.error || "";
        if (msg.toLowerCase().includes("not active")) {
          setError(t("employeeLogin.errors.notActive"));
        } else {
          setError(t("employeeLogin.errors.invalidCredentials"));
        }
      } else {
        setError(data?.error || t("employeeLogin.errors.generic"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="employee-login">
      <header className="employee-login-header">
        <Link to="/" className="employee-login-brand">
          <span className="employee-login-brand-mark">DP</span>
          <span className="employee-login-brand-name">
            {t("layout.brandName")}
          </span>
        </Link>
        <LanguageSwitcher />
      </header>

      <main className="employee-login-main">
        <form
          className="employee-login-card"
          onSubmit={handleSubmit}
          noValidate
        >
          <div className="employee-login-icon">🔐</div>
          <h1>{t("employeeLogin.title")}</h1>
          <p className="employee-login-subtitle">
            {t("employeeLogin.subtitle")}
          </p>

          {showRegisteredBanner && (
            <div className="employee-login-success-banner">
              <span className="employee-login-success-icon">✓</span>
              <span>{t("employeeLogin.justRegistered")}</span>
            </div>
          )}

          {error && <div className="employee-login-server-error">{error}</div>}

          <div className="employee-login-field">
            <label htmlFor="email">
              {t("employeeLogin.fields.email")}{" "}
              <span className="required">*</span>
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (fieldErrors.email) {
                  setFieldErrors((p) => ({ ...p, email: undefined }));
                }
              }}
              placeholder={t("employeeLogin.fields.emailPlaceholder")}
              disabled={submitting}
              className={fieldErrors.email ? "has-error" : ""}
              autoComplete="email"
              autoFocus={!initialEmail}
            />
            {fieldErrors.email && (
              <div className="employee-login-field-error">
                {fieldErrors.email}
              </div>
            )}
          </div>

          <div className="employee-login-field">
            <label htmlFor="password">
              {t("employeeLogin.fields.password")}{" "}
              <span className="required">*</span>
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (fieldErrors.password) {
                  setFieldErrors((p) => ({ ...p, password: undefined }));
                }
              }}
              disabled={submitting}
              className={fieldErrors.password ? "has-error" : ""}
              autoComplete="current-password"
              autoFocus={!!initialEmail}
            />
            {fieldErrors.password && (
              <div className="employee-login-field-error">
                {fieldErrors.password}
              </div>
            )}
          </div>

          <button
            type="submit"
            className="employee-login-btn-primary"
            disabled={submitting}
          >
            {submitting
              ? t("employeeLogin.submitting")
              : t("employeeLogin.submit")}
          </button>

          <div className="employee-login-footer">
            <Link to="/" className="employee-login-footer-link">
              {t("acceptInvitation.backToHome")}
            </Link>
          </div>
        </form>
      </main>
    </div>
  );
}
