import { HTMLAttributes, forwardRef } from "react";

type BadgeVariant =
  | "default"
  | "rgb"
  | "grayscale"
  | "cmyk"
  | "success"
  | "error"
  | "warning"
  | "pink"
  | "purple"
  | "mint";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: "sm" | "md";
  dot?: boolean;
  icon?: React.ReactNode;
}

const variantStyles: Record<BadgeVariant, string> = {
  default: "bg-bg-tertiary text-text-secondary",
  rgb: "bg-accent-tertiary/20 text-accent-tertiary",
  grayscale: "bg-text-secondary/20 text-text-secondary",
  cmyk: "bg-manga-sky/20 text-manga-sky",
  success: "bg-success/20 text-success",
  error: "bg-error/20 text-error",
  warning: "bg-warning/20 text-warning",
  pink: "bg-manga-pink/20 text-manga-pink",
  purple: "bg-accent-secondary/20 text-accent-secondary",
  mint: "bg-manga-mint/20 text-manga-mint",
};

const dotColors: Record<BadgeVariant, string> = {
  default: "bg-text-secondary",
  rgb: "bg-accent-tertiary",
  grayscale: "bg-text-secondary",
  cmyk: "bg-manga-sky",
  success: "bg-success",
  error: "bg-error",
  warning: "bg-warning",
  pink: "bg-manga-pink",
  purple: "bg-accent-secondary",
  mint: "bg-manga-mint",
};

const sizeStyles = {
  sm: "px-2 py-0.5 text-xs",
  md: "px-2.5 py-1 text-xs",
};

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  (
    { variant = "default", size = "md", dot = false, icon, className = "", children, ...props },
    ref,
  ) => {
    return (
      <span
        ref={ref}
        className={`
          inline-flex items-center gap-1.5
          rounded-full font-medium
          ${variantStyles[variant]}
          ${sizeStyles[size]}
          ${className}
        `}
        {...props}
      >
        {dot && <span className={`w-1.5 h-1.5 rounded-full ${dotColors[variant]}`} />}
        {icon && <span className="flex-shrink-0">{icon}</span>}
        {children}
      </span>
    );
  },
);

Badge.displayName = "Badge";

export default Badge;
