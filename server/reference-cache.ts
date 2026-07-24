/**
 * In-memory cache of seeded reference data, filled on boot by seedReferenceData().
 * Engines and routes read from here instead of hitting the DB on every request.
 * Editable data (prompts, settings, data classes) can be re-hydrated after edits.
 */
import { POLICY_CRITERIA_LIST, type CriterionDef } from "@shared/lib/criteria";
import {
  CLASSIFICATION_LEVELS_LIST,
  type ClassificationLevelDef,
} from "@shared/lib/classification";
import type { ClassificationRule } from "./classification-engine/attribute-rules";

export interface CachedPrompt {
  key: string;
  label: string;
  content: string;
}

export interface CachedDataClass {
  code: string;
  nameEn: string;
  nameAr: string;
  category: string;
  isPii: boolean;
  isSpecialCategory: boolean;
  detectionHints: string[];
  source: "ikc" | "adc";
  active: boolean;
}

interface ReferenceCache {
  criteria: CriterionDef[];
  levels: ClassificationLevelDef[];
  prompts: Map<string, CachedPrompt>;
  settings: Map<string, unknown>;
  dataClasses: CachedDataClass[];
}

const cache: ReferenceCache = {
  criteria: POLICY_CRITERIA_LIST,
  levels: CLASSIFICATION_LEVELS_LIST,
  prompts: new Map(),
  settings: new Map(),
  dataClasses: [],
};

export function setPrompt(prompt: CachedPrompt): void {
  cache.prompts.set(prompt.key, prompt);
}

export function getPrompt(key: string): string {
  const prompt = cache.prompts.get(key);
  if (!prompt) {
    throw new Error(`System prompt "${key}" is not seeded.`);
  }
  return prompt.content;
}

export function listPrompts(): CachedPrompt[] {
  return [...cache.prompts.values()];
}

export function setSetting(key: string, value: unknown): void {
  cache.settings.set(key, value);
}

export function getSetting<T = unknown>(key: string): T | undefined {
  return cache.settings.get(key) as T | undefined;
}

export function setDataClasses(classes: CachedDataClass[]): void {
  cache.dataClasses = classes;
}

export function getDataClasses(source?: "ikc" | "adc"): CachedDataClass[] {
  const active = cache.dataClasses.filter((c) => c.active);
  return source ? active.filter((c) => c.source === source) : active;
}

export function getCriteria(): CriterionDef[] {
  return cache.criteria;
}

export function getLevels(): ClassificationLevelDef[] {
  return cache.levels;
}

export function getClassificationRules(): ClassificationRule[] {
  return getSetting<ClassificationRule[]>("classification_rules") ?? [];
}
