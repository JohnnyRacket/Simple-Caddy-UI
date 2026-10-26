import { TokensView } from "@/components/tokens-view";
import { ErrorBoundary } from "@/components/error-boundary";

export default function TokensPage() {
  return (
    <ErrorBoundary label="MCP tokens">
      <TokensView />
    </ErrorBoundary>
  );
}
