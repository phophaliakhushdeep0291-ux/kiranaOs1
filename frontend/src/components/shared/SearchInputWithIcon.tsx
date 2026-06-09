import { Search } from "lucide-react";
import type { InputHTMLAttributes } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface SearchInputWithIconProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string;
  containerClassName?: string;
}

export function SearchInputWithIcon({ label, containerClassName, className, id, ...props }: SearchInputWithIconProps) {
  const inputId = id ?? "shared-search-input";
  return (
    <div className={cn("relative w-full min-w-0", containerClassName)}>
      <label htmlFor={inputId} className="sr-only">{label}</label>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Input
        id={inputId}
        type="search"
        aria-label={label}
        className={cn("h-10 w-full rounded-lg pl-9 shadow-none", className)}
        {...props}
      />
    </div>
  );
}
