import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:scale-[0.99]" +
" hover-elevate active-elevate-2",
  {
    variants: {
      variant: {
        /**
         * Outlined rather than filled. A solid brand block is a lot of colour
         * for a screen somebody works in all day, and this button appears 219
         * times.
         *
         * It still has to read as *the* action, which is the whole risk in
         * un-filling a primary. What keeps it ahead of `outline` is colour
         * rather than weight: this borders and letters in brand, `outline`
         * borders in neutral and inherits its text colour. Both measure 5.6:1
         * on card — comfortably past the 3:1 that a control's edge needs.
         *
         * The tint arrives on hover and press, so the affordance is there
         * without the weight sitting on screen the whole time.
         *
         * `destructive` deliberately stays filled below. Delete and cancel
         * should look heavier than everything around them.
         */
        default:
          "border bg-transparent text-primary [border-color:hsl(var(--primary))] hover:bg-[var(--brand-soft)] active:bg-[var(--brand-border)]",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm border-destructive-border",
        outline:
          // @replit Shows the background color of whatever card / sidebar / accent background it is inside of.
          // Inherits the current text color. Uses shadow-xs. no shadow on active
          // No hover state
          "border bg-background [border-color:var(--button-outline)] shadow-xs hover:bg-muted/70 active:shadow-none",
        secondary:
          // @replit border, no hover, no shadow, secondary border.
          "border bg-secondary text-secondary-foreground border-secondary-border hover:bg-secondary/80",
        // @replit no hover, transparent border
        ghost: "border border-transparent hover:bg-muted/80",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        // @replit changed sizes
        default: "min-h-11 px-4 py-2",
        sm: "min-h-11 rounded-md px-3 text-xs",
        lg: "min-h-12 rounded-lg px-8 text-base",
        icon: "h-11 w-11 min-h-11 min-w-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
