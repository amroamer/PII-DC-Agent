import { useLanguage } from "@/hooks/useLanguage";
import { CatalogScreen } from "@/components/pdtc/CatalogScreen";

export default function AttributesPage() {
  const { lang } = useLanguage();
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">{lang === "ar" ? "السمات" : "Data Attributes"}</h1>
        <p className="text-sm text-muted-foreground">
          {lang === "ar" ? "تصفّح السمات، رشّح، وشغّل محرّكي الكشف والتصنيف." : "Browse attributes, filter, and run the detection + classification engines."}
        </p>
      </header>
      <CatalogScreen screen="attributes" />
    </div>
  );
}
