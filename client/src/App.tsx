import { Route, Router, Switch } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { queryClient } from "@/lib/queryClient";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { LanguageProvider } from "@/context/LanguageContext";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/AppLayout";
import LoginPage from "@/pages/login";
import IngestPage from "@/pages/ingest";
import DetectionPage from "@/pages/detection";
import ClassificationPage from "@/pages/classification";
import ReviewPage from "@/pages/review";
import CoveragePage from "@/pages/coverage";
import SettingsPage from "@/pages/settings";
import AssetsPage from "@/pages/assets";
import AttributesPage from "@/pages/attributes";
import ImportPage from "@/pages/import";
import ImportTestPage from "@/pages/import-test";

function AuthedApp() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="grid h-screen place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return <LoginPage />;

  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={CoveragePage} />
        <Route path="/coverage" component={CoveragePage} />
        <Route path="/ingest" component={IngestPage} />
        <Route path="/assets" component={AssetsPage} />
        <Route path="/attributes" component={AttributesPage} />
        <Route path="/detection" component={DetectionPage} />
        <Route path="/classification" component={ClassificationPage} />
        <Route path="/review" component={ReviewPage} />
        <Route path="/import" component={ImportPage} />
        <Route path="/import-test" component={ImportTestPage} />
        <Route path="/settings">
          {user.role === "admin" ? (
            <SettingsPage />
          ) : (
            <div className="p-10 text-center text-muted-foreground">
              Settings require the admin role.
            </div>
          )}
        </Route>
        <Route>
          <div className="p-10 text-center text-muted-foreground">Page not found.</div>
        </Route>
      </Switch>
    </AppLayout>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <TooltipProvider delayDuration={200}>
          <AuthProvider>
            <Router base="/pdtc">
              <AuthedApp />
            </Router>
            <Toaster />
          </AuthProvider>
        </TooltipProvider>
      </LanguageProvider>
    </QueryClientProvider>
  );
}
