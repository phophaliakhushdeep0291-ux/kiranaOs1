import { useAppLanguage } from "@/features/core/settings/i18n";
import { useRef, type ChangeEvent, type DragEvent, type ReactNode } from "react";
import { useState } from "react";
import { Upload, File, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FileUploadBoxProps {
  label?: string;
  hint?: string;
  error?: string;
  accept?: string;
  multiple?: boolean;
  maxSizeMB?: number;
  onFilesChange?: (files: File[]) => void;
  icon?: ReactNode;
  className?: string;
  disabled?: boolean;
}

export function FileUploadBox({
  label, hint, error, accept, multiple = false,
  maxSizeMB = 5, onFilesChange, icon, className, disabled,
}: FileUploadBoxProps) {
  const { t } = useAppLanguage();
  const [isDragOver, setIsDragOver] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    const arr = Array.from(files).filter((f) => f.size <= maxSizeMB * 1024 * 1024);
    setSelectedFiles(multiple ? arr : arr.slice(0, 1));
    onFilesChange?.(multiple ? arr : arr.slice(0, 1));
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  const removeFile = (index: number) => {
    const next = selectedFiles.filter((_, i) => i !== index);
    setSelectedFiles(next);
    onFilesChange?.(next);
  };

  return (
    <div className={cn("space-y-2", className)}>
      {label && <p className="text-sm font-medium text-foreground">{label}</p>}

      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={label ?? t("chrome.uploadFile")}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inputRef.current?.click(); } }}
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors",
          isDragOver
            ? "border-primary bg-primary/5 text-primary"
            : "border-border bg-muted/20 text-muted-foreground hover:border-primary/50 hover:bg-primary/5",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          onChange={(e: ChangeEvent<HTMLInputElement>) => handleFiles(e.target.files)}
        />
        <span className="grid h-12 w-12 place-items-center rounded-xl bg-background shadow-sm">
          {icon ?? <Upload size={22} aria-hidden="true" />}
        </span>
        <div>
          <p className="text-sm font-semibold">
            {isDragOver ? "Drop files here" : "Click to upload or drag & drop"}
          </p>
          {hint && <p className="mt-0.5 text-xs">{hint}</p>}
          <p className="mt-0.5 text-xs">{t("forms.upload.maxSize", { size: maxSizeMB })}</p>
        </div>
      </div>

      {selectedFiles.length > 0 && (
        <ul className="space-y-1.5">
          {selectedFiles.map((f, i) => (
            <li key={i} className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
              <File size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-xs font-medium">{f.name}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">{(f.size / 1024).toFixed(0)} KB</span>
              <button
                type="button"
                onClick={() => removeFile(i)}
                aria-label={`Remove ${f.name}`}
                className="shrink-0 rounded text-muted-foreground transition-colors hover:text-destructive"
              >
                <X size={13} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
