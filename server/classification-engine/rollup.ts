/**
 * Asset-level high-water-mark rollup. The precedence rule itself lives in
 * shared/lib/classification.ts (rollupLevel) so client and server agree; this
 * module identifies the DRIVING attributes for the rationale.
 */
import { rollupLevel, type ClassificationCode } from "@shared/lib/classification";

export interface AttrLevel {
  attributeId: number;
  columnName: string;
  level: ClassificationCode;
}

export interface AssetRollup {
  level: ClassificationCode | null;
  drivers: string[];
}

export function rollupAssetLevel(attrLevels: AttrLevel[]): AssetRollup {
  const level = rollupLevel(attrLevels.map((a) => a.level));
  const drivers = level ? attrLevels.filter((a) => a.level === level).map((a) => a.columnName) : [];
  return { level, drivers };
}
