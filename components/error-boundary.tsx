"use client";
import { Component, ReactNode } from "react";

export class ErrorBoundary extends Component<
  { children: ReactNode; label: string },
  { error: Error | null }
> {
  state = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground p-8">
          <p className="text-sm font-medium text-destructive">
            {this.props.label} crashed
          </p>
          <pre className="text-xs bg-muted rounded p-3 max-w-lg overflow-auto">
            {(this.state.error as Error).message}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            className="text-xs underline"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
