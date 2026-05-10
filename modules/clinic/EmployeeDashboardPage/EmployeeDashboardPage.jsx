// client/src/pages/clinic/EmployeeDashboardPage/EmployeeDashboardPage.jsx
//
// Authenticated employee dashboard. Wrapped by ClinicLayout(employeeMode=true)
// which already provides:
//  - auth guard (redirects to /clinic/staff-login if no session)
//  - data load via getEmployeeMe()
//  - context passed via Outlet
//
// This page just renders the welcome screen + placeholders for Week 3.

import React from "react";
import { useOutletContext } from "react-router-dom";
import { useTranslation } from "react-i18next";
import "./employeeDashboardPage.css";

export default function EmployeeDashboardPage() {
  const { t, i18n } = useTranslation("clinic");
  const ctx = useOutletContext();

  if (!ctx || ctx.kind !== "employee") {
    // Should not happen — layout handles redirects
    return null;
  }

  const { employee, clinic, role } = ctx;
  const fullName =
    [employee?.firstName, employee?.lastName].filter(Boolean).join(" ") ||
    employee?.email ||
    t("staff.unnamed");

  const formatDate = (d) => {
    if (!d) return "—";
    try {
      return new Date(d).toLocaleDateString(i18n.language || undefined);
    } catch {
      return "—";
    }
  };

  const tier = clinic?.tier || "starter";
  const roleLabel = t(`roles.${role}`, { defaultValue: role });

  return (
    <div className="employee-dashboard">
      <header className="employee-dashboard-header">
        <h1>
          {t("employeeDashboard.welcome", {
            name: employee?.firstName || fullName,
          })}
        </h1>
        <p className="employee-dashboard-subtitle">
          {t("employeeDashboard.subtitle", {
            clinicName: clinic?.name || "—",
          })}
        </p>
      </header>

      <section className="employee-dashboard-info">
        <div className="employee-dashboard-info-card">
          <div className="employee-dashboard-info-icon">👤</div>
          <div className="employee-dashboard-info-content">
            <div className="employee-dashboard-info-label">
              {t("employeeDashboard.profile.fullName")}
            </div>
            <div className="employee-dashboard-info-value">{fullName}</div>
            {employee?.email && (
              <div className="employee-dashboard-info-sub">
                {employee.email}
              </div>
            )}
          </div>
        </div>

        <div className="employee-dashboard-info-card">
          <div className="employee-dashboard-info-icon">🏥</div>
          <div className="employee-dashboard-info-content">
            <div className="employee-dashboard-info-label">
              {t("employeeDashboard.profile.clinic")}
            </div>
            <div className="employee-dashboard-info-value">
              {clinic?.name || "—"}
            </div>
            {clinic?.slug && (
              <div className="employee-dashboard-info-sub">/{clinic.slug}</div>
            )}
          </div>
        </div>

        <div className="employee-dashboard-info-card">
          <div className="employee-dashboard-info-icon">🎖️</div>
          <div className="employee-dashboard-info-content">
            <div className="employee-dashboard-info-label">
              {t("employeeDashboard.profile.role")}
            </div>
            <div className="employee-dashboard-info-value">
              <span className={`employee-dashboard-role-badge role-${role}`}>
                {roleLabel}
              </span>
            </div>
            {employee?.customTitle && (
              <div className="employee-dashboard-info-sub">
                {employee.customTitle}
              </div>
            )}
          </div>
        </div>

        <div className="employee-dashboard-info-card">
          <div className="employee-dashboard-info-icon">📅</div>
          <div className="employee-dashboard-info-content">
            <div className="employee-dashboard-info-label">
              {t("employeeDashboard.profile.joinedAt")}
            </div>
            <div className="employee-dashboard-info-value">
              {formatDate(employee?.joinedAt)}
            </div>
            <div className="employee-dashboard-info-sub">
              {t(`tiers.${tier}`, { defaultValue: tier })}
            </div>
          </div>
        </div>
      </section>

      <section className="employee-dashboard-section">
        <h2>{t("employeeDashboard.quickActions")}</h2>
        <div className="employee-dashboard-actions">
          <button
            className="employee-dashboard-action employee-dashboard-action-disabled"
            disabled
          >
            <span className="employee-dashboard-action-icon">📅</span>
            <span className="employee-dashboard-action-label">
              {t("employeeDashboard.actions.scheduleSoon")}
            </span>
          </button>
          <button
            className="employee-dashboard-action employee-dashboard-action-disabled"
            disabled
          >
            <span className="employee-dashboard-action-icon">👥</span>
            <span className="employee-dashboard-action-label">
              {t("employeeDashboard.actions.patientsSoon")}
            </span>
          </button>
          <button
            className="employee-dashboard-action employee-dashboard-action-disabled"
            disabled
          >
            <span className="employee-dashboard-action-icon">💊</span>
            <span className="employee-dashboard-action-label">
              {t("employeeDashboard.actions.pharmacySoon")}
            </span>
          </button>
        </div>
        <p className="employee-dashboard-coming-soon">
          {t("employeeDashboard.comingSoon")}
        </p>
      </section>
    </div>
  );
}
