/**
 * Layer 2 — ADC/UAE-specific class library lookup. Keyword match of the column
 * metadata against data_classes where source='adc' (Emirates ID, trade licence,
 * declarant/broker, passport, etc.). This is deliberately a PLACEHOLDER keyword
 * matcher — a production class library is out of scope for the skeleton.
 */
import type { DetectionInput, DetectionSignal, EngineContext } from "../types";
import { matchByKeywords } from "../match";
import { criterionForDataClass } from "../criteria";

export function runAdcClassLayer(
  input: DetectionInput,
  _ctx: EngineContext,
): DetectionSignal | null {
  const haystack = [
    input.attribute.columnName,
    input.attribute.descriptionEn,
    input.attribute.descriptionAr,
    input.attribute.piiName,
  ]
    .filter(Boolean)
    .join(" ");

  const match = matchByKeywords(haystack, "adc");
  if (!match) return null;

  const { dataClass, matchedHints } = match;
  const criterion = criterionForDataClass(dataClass);

  return {
    layer: "adc_class",
    verdict: dataClass.isPii ? "pii" : "not_pii",
    criterion,
    dataClassCode: dataClass.code,
    confidence: 0.75,
    rationaleEn: `Column metadata matched the ADC data class "${dataClass.nameEn}" on ${matchedHints.map((h) => `"${h}"`).join(", ")}.`,
    rationaleAr: `تطابقت بيانات العمود الوصفية مع فئة بيانات هيئة الجمارك "${dataClass.nameAr}".`,
    signals: ["columnName", "descriptionEn"],
    evidence: { matchedHints, matchedDataClass: dataClass.code, source: "adc" },
  };
}
