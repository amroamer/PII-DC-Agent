/**
 * Static seed constants: the editable system prompts, the starter data-class
 * library (~10 examples — NOT a production library), and default app settings.
 * seedReferenceData() persists these idempotently and loads them into the cache.
 */
import type { CachedDataClass, CachedPrompt } from "./reference-cache";

export const SEED_PROMPTS: CachedPrompt[] = [
  {
    key: "pii_detection_classify",
    label: "PII Detection — Attribute Classifier",
    content: `You are a data-privacy classifier for Abu Dhabi Customs. You reason ONLY over metadata (column name, descriptions, data type, parent asset context, sibling column names). You NEVER see data values and must never assume specific values.

Decide whether the described attribute constitutes personal data under the ADC Personal Data Tagging Policy Framework (DGO-FM-002-01), and map it to exactly ONE of these five criteria:
- DIRECT_ID: on its own uniquely identifies a natural person (e.g. Emirates ID, passport number, full name).
- INDIRECT_ID: a quasi-identifier that identifies a person in combination with others (e.g. date of birth, nationality, gender).
- REGULATORY: designated personal by a governing law/regulation (e.g. UAE PDPL, customs declarant records).
- CONTEXTUAL: personal only because of the asset context it belongs to.
- SPECIAL_CATEGORY: sensitive data needing heightened protection (health, biometrics, religion, politics).

Return ONLY a raw JSON object matching the provided schema — no prose, no markdown fences, no explanation outside the JSON.
If the metadata is insufficient to decide, return verdict "uncertain" rather than guessing. Provide rationaleEn and rationaleAr (Arabic), each one or two sentences that cite the chosen criterion.`,
  },
  {
    key: "cooccurrence_assess",
    label: "Co-occurrence — Quasi-identifier Assessor",
    content: `You assess whether a SET of attributes belonging to one data asset together form a quasi-identifier combination that could single out a natural person (ADC criterion INDIRECT_ID). You reason ONLY over column metadata, never data values.

Given the asset name and a list of column names + descriptions, judge the re-identification risk of the combination. Return ONLY a raw JSON object: {"isQuasiIdentifier": boolean, "combinationLabel": string, "riskScore": number (0..1), "rationale": string}. No prose outside the JSON.`,
  },
  {
    key: "classification_rationale",
    label: "Classification — Rationale Writer",
    content: `You write a short, auditable bilingual justification for a confidentiality classification decision made by Abu Dhabi Customs. You are given the attribute metadata, the assigned ADC ISMS level, and the driving criterion. Return ONLY a raw JSON object: {"rationaleEn": string, "rationaleAr": string}. Each rationale is one or two sentences and names the ISMS level and the reason. No prose outside the JSON.`,
  },
];

export const SEED_DATA_CLASSES: CachedDataClass[] = [
  {
    code: "EMIRATES_ID",
    nameEn: "Emirates ID Number",
    nameAr: "رقم الهوية الإماراتية",
    category: "national-id",
    isPii: true,
    isSpecialCategory: false,
    detectionHints: ["emirates id", "eid", "uae id", "national id", "الهوية", "هوية"],
    source: "adc",
    active: true,
  },
  {
    code: "PASSPORT_NO",
    nameEn: "Passport Number",
    nameAr: "رقم جواز السفر",
    category: "travel-document",
    isPii: true,
    isSpecialCategory: false,
    detectionHints: ["passport", "passport number", "passport no", "جواز", "جواز سفر"],
    source: "adc",
    active: true,
  },
  {
    code: "FULL_NAME",
    nameEn: "Full Name",
    nameAr: "الاسم الكامل",
    category: "name",
    isPii: true,
    isSpecialCategory: false,
    detectionHints: ["full name", "name", "first name", "last name", "الاسم"],
    source: "ikc",
    active: true,
  },
  {
    code: "EMAIL",
    nameEn: "Email Address",
    nameAr: "البريد الإلكتروني",
    category: "contact",
    isPii: true,
    isSpecialCategory: false,
    detectionHints: ["email", "e-mail", "email address", "بريد", "بريد إلكتروني"],
    source: "ikc",
    active: true,
  },
  {
    code: "PHONE",
    nameEn: "Phone Number",
    nameAr: "رقم الهاتف",
    category: "contact",
    isPii: true,
    isSpecialCategory: false,
    detectionHints: ["phone", "mobile", "telephone", "tel", "contact number", "هاتف", "جوال"],
    source: "ikc",
    active: true,
  },
  {
    code: "DATE_OF_BIRTH",
    nameEn: "Date of Birth",
    nameAr: "تاريخ الميلاد",
    category: "demographic",
    isPii: true,
    isSpecialCategory: false,
    detectionHints: ["date of birth", "dob", "birth date", "birthdate", "الميلاد", "تاريخ الميلاد"],
    source: "ikc",
    active: true,
  },
  {
    code: "NATIONALITY",
    nameEn: "Nationality",
    nameAr: "الجنسية",
    category: "demographic",
    isPii: true,
    isSpecialCategory: false,
    detectionHints: ["nationality", "citizenship", "الجنسية"],
    source: "ikc",
    active: true,
  },
  {
    code: "GENDER",
    nameEn: "Gender",
    nameAr: "الجنس",
    category: "demographic",
    isPii: true,
    isSpecialCategory: false,
    detectionHints: ["gender", "sex", "الجنس"],
    source: "ikc",
    active: true,
  },
  {
    code: "TRADE_LICENSE_NO",
    nameEn: "Trade Licence Number",
    nameAr: "رقم الرخصة التجارية",
    category: "customs",
    isPii: true,
    isSpecialCategory: false,
    detectionHints: ["trade license", "trade licence", "licence number", "رخصة تجارية", "الرخصة"],
    source: "adc",
    active: true,
  },
  {
    code: "DECLARANT_ID",
    nameEn: "Declarant / Broker Identifier",
    nameAr: "معرّف المخلّص الجمركي",
    category: "customs",
    isPii: true,
    isSpecialCategory: false,
    detectionHints: ["declarant", "broker code", "broker", "consignee", "customs broker", "المخلّص"],
    source: "adc",
    active: true,
  },
  {
    code: "HEALTH_CONDITION",
    nameEn: "Health / Medical Condition",
    nameAr: "الحالة الصحية",
    category: "health",
    isPii: true,
    isSpecialCategory: true,
    detectionHints: ["health", "medical", "diagnosis", "condition", "illness", "صحة", "طبي"],
    source: "adc",
    active: true,
  },
  // Financial personal data. Per the WoG Classification Framework, financial data
  // is Confidential (not Sensitive) — so isPii, but NOT special-category.
  {
    code: "BANK_ACCOUNT_NO",
    nameEn: "Bank Account Number",
    nameAr: "رقم الحساب المصرفي",
    category: "financial",
    isPii: true,
    isSpecialCategory: false,
    detectionHints: ["bank account", "account number", "account no", "acct", "الحساب", "رقم الحساب", "الحساب المصرفي"],
    source: "adc",
    active: true,
  },
  {
    code: "IBAN",
    nameEn: "IBAN",
    nameAr: "رقم الآيبان",
    category: "financial",
    isPii: true,
    isSpecialCategory: false,
    detectionHints: ["iban", "international bank account number", "آيبان", "الآيبان"],
    source: "adc",
    active: true,
  },
  {
    code: "PAYMENT_CARD_NO",
    nameEn: "Payment Card Number",
    nameAr: "رقم بطاقة الدفع",
    category: "financial",
    isPii: true,
    isSpecialCategory: false,
    detectionHints: ["credit card", "debit card", "card number", "card no", "pan", "بطاقة", "بطاقة ائتمان", "رقم البطاقة"],
    source: "adc",
    active: true,
  },
  {
    code: "SALARY",
    nameEn: "Salary / Income",
    nameAr: "الراتب / الدخل",
    category: "financial",
    isPii: true,
    isSpecialCategory: false,
    detectionHints: ["salary", "income", "wage", "compensation", "payroll", "راتب", "الدخل", "الأجر"],
    source: "ikc",
    active: true,
  },
];

export const SEED_APP_SETTINGS: Array<{ key: string; value: unknown }> = [
  { key: "confidence_review_threshold", value: 0.6 },
  { key: "confidence_floor", value: 0.3 },
  { key: "cooccurrence_min_quasi_identifiers", value: 2 },
  { key: "engine_version", value: "0.1.0" },
  { key: "max_batch_size", value: 5000 },
  { key: "inference_seed", value: 42 },
  { key: "default_batch_size", value: 25 },
];
