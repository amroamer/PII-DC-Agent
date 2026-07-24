export type Lang = "en" | "ar";

/** UI string dictionary. Every user-facing label has an EN and AR string. */
export const STRINGS: Record<string, { en: string; ar: string }> = {
  "app.name": {
    en: "Personal Data Tagging & Classification Workbench",
    ar: "منصة وسم وتصنيف البيانات الشخصية",
  },
  "app.short": { en: "PDTC", ar: "منصة التصنيف" },
  "app.org": { en: "Abu Dhabi Customs", ar: "جمارك أبوظبي" },

  "nav.ingest": { en: "Ingest", ar: "الاستيراد" },
  "nav.assets": { en: "Data Assets", ar: "الأصول" },
  "nav.attributes": { en: "Data Attributes", ar: "السمات" },
  "nav.import": { en: "Import", ar: "إعادة الاستيراد" },
  "nav.importTest": { en: "Import Test", ar: "اختبار الاستيراد" },
  "nav.detection": { en: "PII Detection", ar: "كشف البيانات الشخصية" },
  "nav.classification": { en: "Classification", ar: "التصنيف" },
  "nav.review": { en: "Review Queue", ar: "قائمة المراجعة" },
  "nav.coverage": { en: "Coverage", ar: "التغطية" },
  "nav.settings": { en: "Settings", ar: "الإعدادات" },

  "action.logout": { en: "Sign out", ar: "تسجيل الخروج" },
  "action.run": { en: "Run", ar: "تشغيل" },
  "action.upload": { en: "Upload", ar: "رفع" },
  "action.import": { en: "Run import", ar: "تنفيذ الاستيراد" },
  "action.cancel": { en: "Cancel", ar: "إلغاء" },
  "action.save": { en: "Save", ar: "حفظ" },
  "action.accept": { en: "Accept", ar: "قبول" },
  "action.reject": { en: "Reject", ar: "رفض" },
  "action.override": { en: "Override", ar: "تجاوز" },

  "login.title": { en: "Sign in", ar: "تسجيل الدخول" },
  "login.username": { en: "Username", ar: "اسم المستخدم" },
  "login.password": { en: "Password", ar: "كلمة المرور" },
  "login.submit": { en: "Sign in", ar: "دخول" },
  "login.subtitle": {
    en: "Metadata governance workbench · metadata-only, no data values leave the ADC boundary.",
    ar: "منصة حوكمة البيانات الوصفية — بيانات وصفية فقط، لا تغادر القيم حدود الجمارك.",
  },

  "ingest.title": { en: "Ingest IKC Exports", ar: "استيراد مخرجات IKC" },
  "ingest.drop": { en: "Upload an IKC asset or attribute export (.xlsx)", ar: "ارفع ملف تصدير الأصول أو السمات (.xlsx)" },
  "ingest.mapping": { en: "Column Mapping", ar: "ربط الأعمدة" },
  "ingest.runs": { en: "Import Runs", ar: "عمليات الاستيراد" },
  "ingest.summary": { en: "Import Summary", ar: "ملخص الاستيراد" },

  "detection.title": { en: "PII Detection Engine", ar: "محرك كشف البيانات الشخصية" },
  "detection.run": { en: "Run detection", ar: "تشغيل الكشف" },
  "detection.results": { en: "Flagged Attributes", ar: "السمات الموسومة" },
  "detection.evidence": { en: "Evidence", ar: "الأدلة" },

  "classification.title": { en: "Classification Engine", ar: "محرك التصنيف" },
  "classification.attributes": { en: "Attribute Labels", ar: "تصنيف السمات" },
  "classification.assets": { en: "Asset Rollup", ar: "تجميع الأصول" },
  "classification.rationale": { en: "Justification", ar: "المبرر" },

  "review.title": { en: "Steward Review Queue", ar: "قائمة مراجعة أمين البيانات" },
  "coverage.title": { en: "Tagging Coverage", ar: "تغطية الوسم" },
  "settings.title": { en: "Settings", ar: "الإعدادات" },

  "field.verdict": { en: "Verdict", ar: "القرار" },
  "field.criterion": { en: "Criterion", ar: "المعيار" },
  "field.confidence": { en: "Confidence", ar: "الثقة" },
  "field.asset": { en: "Asset", ar: "الأصل" },
  "field.column": { en: "Column", ar: "العمود" },
  "field.level": { en: "Classification", ar: "التصنيف" },
  "field.priority": { en: "Priority", ar: "الأولوية" },
  "field.status": { en: "Status", ar: "الحالة" },
  "field.rationale": { en: "Rationale", ar: "المبرر" },

  "verdict.pii": { en: "Personal Data", ar: "بيانات شخصية" },
  "verdict.not_pii": { en: "Not Personal", ar: "غير شخصية" },
  "verdict.uncertain": { en: "Uncertain", ar: "غير مؤكد" },

  "empty.none": { en: "Nothing here yet", ar: "لا يوجد شيء بعد" },
  "common.loading": { en: "Loading…", ar: "جارٍ التحميل…" },
};

export function translate(key: string, lang: Lang): string {
  return STRINGS[key]?.[lang] ?? key;
}
