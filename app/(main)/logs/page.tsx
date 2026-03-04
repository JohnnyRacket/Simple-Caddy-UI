import { LogViewer } from "@/components/log-viewer";
import { ErrorBoundary } from "@/components/error-boundary";

export default function LogsPage() {
  return (
    <ErrorBoundary label="Log viewer">
      <LogViewer />
    </ErrorBoundary>
  );
}
