import { EditorShell } from "@/components/editor-shell";
import { ErrorBoundary } from "@/components/error-boundary";

export default function EditorPage() {
  return (
    <ErrorBoundary label="Editor">
      <EditorShell />
    </ErrorBoundary>
  );
}
