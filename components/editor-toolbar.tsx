import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Save, RefreshCw, CheckCircle, WrapText, Loader2 } from "lucide-react";

export type ActionStatus = "idle" | "loading" | "success" | "error";

interface EditorToolbarProps {
  onSave: () => void;
  onReload: () => void;
  onValidate: () => void;
  onFormat: () => void;
  saveStatus: ActionStatus;
  reloadStatus: ActionStatus;
  validateStatus: ActionStatus;
  formatStatus: ActionStatus;
  dirty: boolean;
}

function StatusBadge({ status, label }: { status: ActionStatus; label: string }) {
  if (status === "idle") return null;
  if (status === "loading") return null;
  const variant = status === "success" ? "default" : "destructive";
  return (
    <Badge variant={variant} className="text-xs">
      {status === "success" ? `${label} OK` : `${label} failed`}
    </Badge>
  );
}

function ActionButton({
  onClick,
  status,
  icon: Icon,
  label,
  disabled,
}: {
  onClick: () => void;
  status: ActionStatus;
  icon: React.ElementType;
  label: string;
  disabled?: boolean;
}) {
  const loading = status === "loading";
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={onClick}
      disabled={disabled || loading}
      className="gap-1.5"
    >
      {loading ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <Icon className="size-3.5" />
      )}
      {label}
    </Button>
  );
}

export function EditorToolbar({
  onSave,
  onReload,
  onValidate,
  onFormat,
  saveStatus,
  reloadStatus,
  validateStatus,
  formatStatus,
  dirty,
}: EditorToolbarProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card shrink-0">
      <ActionButton
        onClick={onSave}
        status={saveStatus}
        icon={Save}
        label="Save"
      />
      <ActionButton
        onClick={onReload}
        status={reloadStatus}
        icon={RefreshCw}
        label="Reload"
      />
      <ActionButton
        onClick={onValidate}
        status={validateStatus}
        icon={CheckCircle}
        label="Validate"
      />
      <ActionButton
        onClick={onFormat}
        status={formatStatus}
        icon={WrapText}
        label="Format"
      />
      <Separator orientation="vertical" className="h-5 mx-1" />
      {dirty && (
        <span className="text-xs text-muted-foreground">Unsaved changes</span>
      )}
      <div className="flex items-center gap-2 ml-auto">
        <StatusBadge status={saveStatus} label="Save" />
        <StatusBadge status={reloadStatus} label="Reload" />
      </div>
    </div>
  );
}
