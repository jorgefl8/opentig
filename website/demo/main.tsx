import "../../src/renderer/styles/index.css";
import "./style.css";
import { createRoot } from "react-dom/client";
import { Suspense, lazy, useEffect } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sileo";
import { queryClient } from "@/lib/query-client";
import { MobileViewport } from "@/components/MobileViewport";
const App = lazy(() => import("@/app/App"));
const initialSelection = {
  type: "diff",
  path: "src/filter-tasks.js",
  kind: "unstaged",
} as const;
function Ready() {
  useEffect(() => {
    window.parent.postMessage(
      { type: "opentig-demo-ready" },
      window.location.origin,
    );
    document.querySelector("[data-demo-loading]")?.remove();
  }, []);
  return <App pullRequestCreationDisabledReason="PR creation requires a connected repository" initialView="changes" initialSelection={initialSelection} />;
}
const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <QueryClientProvider client={queryClient}>
      <MobileViewport />
      <Toaster theme="light" position="bottom-right" />
      <Suspense
        fallback={
          <p className="demo-loading" role="status">
            Loading OpenTig…
          </p>
        }
      >
        <Ready />
      </Suspense>
    </QueryClientProvider>,
  );
