import { useLanguage } from "@/hooks/useLanguage";
import { CatalogScreen } from "@/components/pdtc/CatalogScreen";

export default function AssetsPage() {
  const { lang } = useLanguage();
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">{lang === "ar" ? "الأصول" : "Data Assets"}</h1>
        <p className="text-sm text-muted-foreground">
          {lang === "ar" ? "تصفّح الأصول، رشّح، وشغّل المحركات على مجموعة محددة." : "Browse assets, filter, and run engines over a selection."}
        </p>
      </header>
      <CatalogScreen screen="assets" />
    </div>
  );
}
