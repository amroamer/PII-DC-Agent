-- Parse IKC list-shaped fields into jsonb string[] IN PLACE — no data loss, no re-import required.
--
-- IKC exports these fields as Python list literals ('[''Analytical'']', with literal \t / \n
-- escapes and single quotes) and the suggested classes as a JSON object array. This migration
-- converts existing catalog rows the same way server/ingest/parse.ts does (asList / asClassNames),
-- so an already-populated database keeps its domains / subject areas / stewards / classes.
--
-- Two helper functions live in pg_temp and vanish when the migrate session ends.

CREATE FUNCTION pg_temp.ikc_parse_list(raw text) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE
  parts text[];
  out_arr text[] := ARRAY[]::text[];
  piece text;
  cleaned text;
BEGIN
  IF raw IS NULL OR btrim(raw) = '' THEN
    RETURN NULL;
  END IF;
  IF raw ~ E'^\\s*\\[.*\\]\\s*$' THEN
    -- Python / JSON list literal: pull out every single- or double-quoted segment.
    SELECT array_agg(COALESCE(t.m[1], t.m[2]))
      INTO parts
      FROM regexp_matches(raw, $re$'([^']*)'|"([^"]*)"$re$, 'g') AS t(m);
  ELSE
    -- Plain delimited string (e.g. stewards "a; b").
    parts := regexp_split_to_array(raw, '[;,|]');
  END IF;
  IF parts IS NULL THEN
    RETURN NULL;
  END IF;
  FOREACH piece IN ARRAY parts LOOP
    -- Collapse literal \t \n \r escapes and real whitespace; trim.
    cleaned := btrim(regexp_replace(
                 replace(replace(replace(piece, E'\\t', ' '), E'\\n', ' '), E'\\r', ' '),
                 E'\\s+', ' ', 'g'));
    IF cleaned <> '' AND NOT (cleaned = ANY(out_arr)) THEN
      out_arr := array_append(out_arr, cleaned);
    END IF;
  END LOOP;
  IF array_length(out_arr, 1) IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN to_jsonb(out_arr);
END;
$fn$;
--> statement-breakpoint
CREATE FUNCTION pg_temp.ikc_class_names(raw text) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE
  j jsonb;
  out_arr text[] := ARRAY[]::text[];
  elem jsonb;
  nm text;
BEGIN
  IF raw IS NULL OR btrim(raw) = '' THEN
    RETURN NULL;
  END IF;
  BEGIN
    j := raw::jsonb;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
  IF jsonb_typeof(j) <> 'array' THEN
    RETURN NULL;
  END IF;
  FOR elem IN SELECT jsonb_array_elements(j) LOOP
    IF jsonb_typeof(elem) = 'object' THEN
      nm := btrim(elem->>'name');
    ELSE
      nm := btrim(elem #>> '{}');
    END IF;
    IF nm IS NOT NULL AND nm <> '' AND NOT (nm = ANY(out_arr)) THEN
      out_arr := array_append(out_arr, nm);
    END IF;
  END LOOP;
  IF array_length(out_arr, 1) IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN to_jsonb(out_arr);
END;
$fn$;
--> statement-breakpoint
ALTER TABLE "assets" ALTER COLUMN "business_domain" TYPE jsonb USING pg_temp.ikc_parse_list("business_domain");--> statement-breakpoint
ALTER TABLE "assets" ALTER COLUMN "subject_area" TYPE jsonb USING pg_temp.ikc_parse_list("subject_area");--> statement-breakpoint
ALTER TABLE "assets" ALTER COLUMN "department" TYPE jsonb USING pg_temp.ikc_parse_list("department");--> statement-breakpoint
ALTER TABLE "assets" ALTER COLUMN "sector" TYPE jsonb USING pg_temp.ikc_parse_list("sector");--> statement-breakpoint
ALTER TABLE "assets" ALTER COLUMN "stewards" TYPE jsonb USING pg_temp.ikc_parse_list("stewards");--> statement-breakpoint
-- backup_frequency stays scalar text: unwrap the single-element list (e.g. ['Monthly'] -> Monthly).
UPDATE "assets" SET "backup_frequency" = pg_temp.ikc_parse_list("backup_frequency") ->> 0
  WHERE "backup_frequency" IS NOT NULL AND left(btrim("backup_frequency"), 1) = '[';--> statement-breakpoint
-- suggested_classes is already jsonb but held comma-split JSON garbage; re-derive clean class
-- names from the original raw cell. Left untouched where the source cell isn't available.
UPDATE "attributes" SET "suggested_classes" = pg_temp.ikc_class_names("raw_row"->>'Suggested Classes')
  WHERE "raw_row" ? 'Suggested Classes';
