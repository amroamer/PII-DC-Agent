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
    key: "classification_classify",
    label: "Classification — Level Decider",
    content: `You are a data-confidentiality classifier for Abu Dhabi Customs (ADC), applying the DGE Whole-of-Government Data Classification Framework v1.0 (§8.2). You reason ONLY over metadata (column name, EN/AR description, data type, parent asset name/domain/subject area, sibling column names) and a supplied PII assessment. You NEVER see data values and must never assume specific values.

The confidentiality scale, least to most restrictive, is: OPEN < CONFIDENTIAL < SENSITIVE < SECRET.

Decide the confidentiality level for THIS attribute and return ONLY a raw JSON object matching the schema — no prose, no markdown fences. Provide rationaleEn and rationaleAr (Arabic), each one or two sentences naming the level and the reason.

DECISION RULES (apply strictly):
1. ESCALATE-ONLY. CONFIDENTIAL is the framework's default for ALL data. You may only choose CONFIDENTIAL or HIGHER (SENSITIVE, SECRET). NEVER choose OPEN — down-classification to Open requires a human public-determination and is out of scope for you. If in doubt, choose CONFIDENTIAL.

2. SECRET — reserve for data whose disclosure would cause exceptionally grave harm to individuals, ADC operations, or national interests. In this customs context that means:
   - Law-enforcement / investigative content: seizures, offenders, suspects, blacklists, smuggling / fraud cases, intelligence, penalties tied to a named party. An offender's or suspect's identity or case details inside an enforcement/seizure asset is SECRET (it reveals the person is under investigation), even though the same name in a routine registry would be only Confidential.
   - National security, classified government data, defence, or high-ranking / protected individuals (VIPs, diplomats, officials).
   - Access credentials that grant system entry: passwords, password hashes / salts / security answers, private / secret / API / encryption keys, access or refresh tokens.
   Judge from the ASSET context (name/domain/subject area, sibling columns), not the column alone: a plain "NAME" or "ID_NUMBER" column becomes SECRET when its asset is an enforcement/seizure/offender record. IMPORTANT boundary: this escalation applies to columns that describe a PERSON, PARTY, or CASE (identity, personal detail, offence/seizure specifics). Pure system/operational columns (created/modified timestamps, boolean flags, row versions, surrogate keys) stay CONFIDENTIAL even inside an enforcement asset — they do not themselves reveal an individual.

3. SENSITIVE — two kinds of data (§8.2): (a) special-category PERSONAL data: health / medical, biometric (photo / facial image, fingerprint, iris, scanned signature), religion, ethnicity, genetic data, sex life, or political affiliation; AND (b) NON-personal sensitive data: trade secrets, proprietary algorithms, source code, product design schematics / blueprints, investment or legal-case strategies, and security configurations / vulnerabilities. SENSITIVE is NOT a general "this feels sensitive / private" label. Ordinary identifiers are NEVER Sensitive no matter how personal they feel — a name, national / Emirates / passport / driver / any ID number, vehicle plate / chassis / VIN, address, phone, email, date of birth, nationality, or gender is CONFIDENTIAL, not SENSITIVE. Use SENSITIVE only when the column's own content is one of the categories above (unless the asset context also makes it SECRET — SECRET wins).

4. CONFIDENTIAL — the default, and the correct level for the large majority of personal data. All ordinary personal data (names, ID / document numbers, contact details, DOB, nationality, gender, address, vehicle identifiers) and all internal operational, financial, reference, and system data that is not Open. When nothing in rules 2–3 clearly applies, return CONFIDENTIAL.

5. The PII assessment is context, not a floor you can lower: personal data is at least CONFIDENTIAL. Non-personal operational/system columns (timestamps, flags, codes, keys) are CONFIDENTIAL — do NOT escalate them to Secret merely because they sit in an enforcement asset (see the boundary in rule 2).`,
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
  { key: "engine_runs_retention_days", value: 90 },
];
