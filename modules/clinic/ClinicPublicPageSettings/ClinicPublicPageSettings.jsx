// client/src/pages/clinic/ClinicPublicPageSettings/ClinicPublicPageSettings.jsx
//
// Clinic-as-Brand (этап A) — раздел «Публичная страница» в clinic-настройках.
// Владелец/админ: редактирует описание, публикует/снимает страницу /clinics/:slug.
//
// Данные: getClinicMe() → clinic.{id,slug,description,isPublished,isVerified,logo}
// Сохранение: updateClinic(id,{description}) + setClinicPublished(id,bool)
//
// Конвенция clinic-домена: внешний CSS + useTranslation("clinic").

import React, { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  getClinicMe,
  updateClinic,
  setClinicPublished,
} from "../../../api/clinic";
import "./clinicPublicPageSettings.css";

const DESC_MAX = 5000;

export default function ClinicPublicPageSettings() {
  const { t } = useTranslation("clinic");
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [clinic, setClinic] = useState(null);
  const [canWrite, setCanWrite] = useState(false);

  // editable state
  const [description, setDescription] = useState("");
  const [isPublished, setIsPublished] = useState(false);

  // ui state
  const [savingDesc, setSavingDesc] = useState(false);
  const [savingPub, setSavingPub] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const me = await getClinicMe();
        if (cancelled) return;

        if (!me.hasClinic) {
          navigate("/clinic", { replace: true });
          return;
        }

        const c = me.clinic || {};
        const role = me.role || "member";
        const perms = me.permissions || {};
        const writable =
          role === "owner" || role === "admin" || perms?.clinic?.write === true;

        setClinic(c);
        setDescription(c.description || "");
        setIsPublished(c.isPublished === true);
        setCanWrite(writable);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        console.error("PublicPageSettings load failed:", err);
        setError(err.message || t("common.error", { defaultValue: "Ошибка" }));
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate, t]);

  const flashSaved = () => {
    setSavedMsg(t("publicPage.saved", { defaultValue: "Сохранено" }));
    setTimeout(() => setSavedMsg(""), 2500);
  };

  const handleSaveDescription = async () => {
    if (!clinic?.id || savingDesc) return;
    setSavingDesc(true);
    setError(null);
    try {
      await updateClinic(clinic.id, { description });
      flashSaved();
    } catch (err) {
      console.error("save description failed:", err);
      setError(
        err?.response?.data?.error ||
          t("publicPage.saveError", {
            defaultValue: "Не удалось сохранить описание",
          }),
      );
    } finally {
      setSavingDesc(false);
    }
  };

  const handleTogglePublish = async () => {
    if (!clinic?.id || savingPub) return;
    const next = !isPublished;
    setSavingPub(true);
    setError(null);
    try {
      await setClinicPublished(clinic.id, next);
      setIsPublished(next);
      flashSaved();
    } catch (err) {
      console.error("toggle publish failed:", err);
      setError(
        err?.response?.data?.error ||
          t("publicPage.publishError", {
            defaultValue: "Не удалось изменить статус публикации",
          }),
      );
    } finally {
      setSavingPub(false);
    }
  };

  if (loading) {
    return (
      <div className="cpps-loading">
        <div className="cpps-spinner" />
      </div>
    );
  }

  if (error && !clinic) {
    return (
      <div className="cpps-error">
        <h2>{t("common.error", { defaultValue: "Ошибка" })}</h2>
        <p>{error}</p>
      </div>
    );
  }

  const publicUrl = clinic?.slug ? `/clinics/${clinic.slug}` : null;

  return (
    <div className="cpps">
      <header className="cpps-header">
        <h1 className="cpps-title">
          {t("publicPage.title", { defaultValue: "Публичная страница" })}
        </h1>
        <p className="cpps-subtitle">
          {t("publicPage.subtitle", {
            defaultValue:
              "Мини-сайт клиники для пациентов: описание, врачи, контакты.",
          })}
        </p>
      </header>

      {!canWrite && (
        <div className="cpps-banner cpps-banner-warn">
          {t("publicPage.noPermission", {
            defaultValue:
              "У вас нет прав на редактирование. Обратитесь к владельцу клиники.",
          })}
        </div>
      )}

      {error && clinic && (
        <div className="cpps-banner cpps-banner-error">{error}</div>
      )}

      {/* PUBLISH TOGGLE */}
      <section className="cpps-card">
        <div className="cpps-card-head">
          <h2 className="cpps-card-title">
            {t("publicPage.statusTitle", { defaultValue: "Статус" })}
          </h2>
        </div>
        <div className="cpps-card-body">
          <div className="cpps-toggle-row">
            <div className="cpps-toggle-info">
              <div className="cpps-toggle-label">
                {isPublished
                  ? t("publicPage.published", {
                      defaultValue: "Страница опубликована",
                    })
                  : t("publicPage.unpublished", {
                      defaultValue: "Страница скрыта",
                    })}
              </div>
              <div className="cpps-toggle-hint">
                {isPublished
                  ? t("publicPage.publishedHint", {
                      defaultValue: "Страница видна всем по ссылке ниже.",
                    })
                  : t("publicPage.unpublishedHint", {
                      defaultValue:
                        "Опубликуйте, когда профиль готов — тогда страница станет видна.",
                    })}
              </div>
            </div>
            <button
              type="button"
              className={`cpps-switch${isPublished ? " on" : ""}`}
              role="switch"
              aria-checked={isPublished}
              disabled={!canWrite || savingPub}
              onClick={handleTogglePublish}
            >
              <span className="cpps-switch-knob" />
            </button>
          </div>

          {/* preview link */}
          {publicUrl && (
            <div className="cpps-preview">
              <span className="cpps-preview-label">
                {t("publicPage.linkLabel", { defaultValue: "Адрес страницы:" })}
              </span>
              {isPublished ? (
                <a
                  href={publicUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="cpps-preview-link"
                >
                  {window.location.origin}
                  {publicUrl} ↗
                </a>
              ) : (
                <span className="cpps-preview-muted">
                  {window.location.origin}
                  {publicUrl}
                </span>
              )}
            </div>
          )}
        </div>
      </section>

      {/* DESCRIPTION */}
      <section className="cpps-card">
        <div className="cpps-card-head">
          <h2 className="cpps-card-title">
            {t("publicPage.descTitle", { defaultValue: "Описание клиники" })}
          </h2>
        </div>
        <div className="cpps-card-body">
          <textarea
            className="cpps-textarea"
            value={description}
            maxLength={DESC_MAX}
            disabled={!canWrite || savingDesc}
            placeholder={t("publicPage.descPlaceholder", {
              defaultValue:
                "Расскажите о клинике: направления, история, преимущества…",
            })}
            onChange={(e) => setDescription(e.target.value)}
            rows={8}
          />
          <div className="cpps-desc-foot">
            <span className="cpps-counter">
              {description.length} / {DESC_MAX}
            </span>
            <div className="cpps-actions">
              {savedMsg && <span className="cpps-saved">{savedMsg}</span>}
              <button
                type="button"
                className="cpps-btn cpps-btn-primary"
                disabled={!canWrite || savingDesc}
                onClick={handleSaveDescription}
              >
                {savingDesc
                  ? t("common.saving", { defaultValue: "Сохранение…" })
                  : t("common.save", { defaultValue: "Сохранить" })}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* footnote: media / reviews / publications — следующие этапы */}
      <div className="cpps-foot-note">
        {t("publicPage.moreSoon", {
          defaultValue:
            "Логотип, фото-галерея, отзывы и публикации появятся в следующих обновлениях.",
        })}
      </div>

      <div className="cpps-back">
        <Link to="/clinic/dashboard" className="cpps-back-link">
          ← {t("common.backToDashboard", { defaultValue: "К дашборду" })}
        </Link>
      </div>
    </div>
  );
}
