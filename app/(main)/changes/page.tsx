import { Suspense } from "react";
import { ChangesView } from "@/components/changes-view";
import { ErrorBoundary } from "@/components/error-boundary";

export default function ChangesPage() {
  return (
    <ErrorBoundary label="Changes">
      {/* useSearchParams needs a Suspense boundary */}
      <Suspense>
        <ChangesView />
      </Suspense>
    </ErrorBoundary>
  );
}
