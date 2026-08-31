// common/i18n/dictionaries/ar.js
//
// Сообщения сервера, которые видит человек. Ключ — код, значение —
// текст. Подстановки записываются как {{имя}}.
//
// العربية.

export default {
  "common.unauthorized": "غير مُصدَّق",
  "common.forbidden": "الوصول مرفوض",
  "common.notFound": "غير موجود",
  "common.badId": "صيغة المعرّف غير صحيحة",
  "common.serverError": "خطأ داخلي في الخادم",
  "common.tooManyRequests": "محاولات كثيرة. حاول لاحقاً.",
  "common.validationFailed": "تحقق من الحقول المُدخَلة",
  "common.saveFailed": "تعذر الحفظ",
  "common.deleteFailed": "تعذر الحذف",
  "common.loadFailed": "تعذر تحميل البيانات",
  "patient.notFound": "لم يُعثر على المريض",
  "patient.required": "يجب تحديد المريض",
  "clinic.notFound": "لم يُعثر على العيادة",
  "clinic.membershipRequired": "العضوية في العيادة مطلوبة",
  "clinic.featureNotInPlan": "هذا القسم مشمول في باقتَي Business وEnterprise",
  "clinic.analyticsNotInPlan": "تحليلات العيادة مشمولة في باقتَي Business وEnterprise",
  "prescription.notFound": "لم يُعثر على الوصفة",
  "prescription.needsItem": "يلزم بند واحد على الأقل بالاسم الدولي (INN)",
  "prescription.onlyActiveEditable": "يمكن تعديل الوصفة الفعّالة فقط. ألغِها واكتب واحدة جديدة.",
  "prescription.alreadyDispensed": "صُرفت الوصفة بالفعل ولا يمكن تعديلها. ألغِها واكتب واحدة جديدة.",
  "consent.duplicatePending": "أُرسل طلب إلى هذا المريض بالفعل وينتظر الرد. انتظر الرد أو اسحب الطلب السابق.",
  "consent.alreadyGranted": "منح المريض العيادة حق الوصول إلى هذه البيانات بالفعل — لا حاجة لطلبها مجدداً.",
};
