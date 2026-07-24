/**
 * Layer 1 — reuse IKC's own output. Reads the attribute's selectedDataClassName /
 * selectedDataClassConfidence / suggestedClasses and maps them onto PDTC's
 * data_classes. No re-implementation of pattern matching happens here.
 */
import type { DetectionInput, DetectionSignal, EngineContext } from "../types";
import { matchByName } from "../match";
import { criterionForDataClass } from "../criteria";

export function runIkcClassLayer(
  input: DetectionInput,
  _ctx: EngineContext,
): DetectionSignal | null {
  const selected = input.attribute.selectedDataClassName;
  const suggested = input.attribute.suggestedClasses ?? [];
  const candidateName = selected ?? suggested[0];
  if (!candidateName) return null;

  const dataClass = matchByName(candidateName);
  if (!dataClass) return null;

  const criterion = criterionForDataClass(dataClass);
  const verdict = dataClass.isPii ? "pii" : "not_pii";
  const confidence = input.attribute.selectedDataClassConfidence ?? (selected ? 0.7 : 0.5);

  return {
    layer: "ikc_class",
    verdict,
    criterion,
    dataClassCode: dataClass.code,
    confidence,
    rationaleEn: `IKC assigned data class "${dataClass.nameEn}" to this attribute, which is ${dataClass.isPii ? "personal data" : "not personal data"}.`,
    rationaleAr: `صنّف نظام IKC هذه السمة ضمن فئة البيانات "${dataClass.nameAr}"، وهي ${dataClass.isPii ? "بيانات شخصية" : "ليست بيانات شخصية"}.`,
    signals: ["selectedDataClassName", "suggestedClasses"],
    evidence: {
      selectedDataClassName: selected,
      selectedDataClassConfidence: input.attribute.selectedDataClassConfidence,
      suggestedClasses: suggested,
      matchedDataClass: dataClass.code,
    },
  };
}
