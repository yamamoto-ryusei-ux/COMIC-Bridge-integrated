import { ButtonHTMLAttributes, forwardRef } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success";
type ButtonSize = "sm" | "md" | "lg";

interface PopButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ReactNode;
  iconPosition?: "left" | "right";
  loading?: boolean;
  glow?: boolean;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary: `
    text-white
    bg-gradient-to-r from-accent to-accent-secondary
    shadow-[0_4px_15px_rgba(255,107,157,0.3)]
    hover:shadow-[0_6px_20px_rgba(255,107,157,0.4)]
    hover:-translate-y-0.5
  `,
  secondary: `
    bg-bg-tertiary text-text-primary
    border border-accent/30 hover:border-accent/50
    hover:bg-bg-elevated
  `,
  ghost: `
    bg-transparent text-text-secondary
    hover:text-text-primary hover:bg-bg-tertiary
  `,
  danger: `
    bg-error/20 text-error
    border border-error/30
    hover:bg-error/30
  `,
  success: `
    text-white
    bg-gradient-to-r from-accent-tertiary to-accent-secondary
    shadow-[0_4px_15px_rgba(0,212,170,0.3)]
    hover:shadow-[0_6px_20px_rgba(0,212,170,0.4)]
    hover:-translate-y-0.5
  `,
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs rounded-lg gap-1.5",
  md: "px-4 py-2 text-sm rounded-xl gap-2",
  lg: "px-6 py-3 text-base rounded-xl gap-2.5",
};

export const PopButton = forwardRef<HTMLButtonElement, PopButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      icon,
      iconPosition = "left",
      loading = false,
      glow = false,
      className = "",
      children,
      disabled,
      ...props
    },
    ref,
  ) => {
    const baseStyles = `
      inline-flex items-center justify-center
      font-medium
      transition-all duration-200
      focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50
      active:scale-95
      disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none
    `;

    const glowStyles = glow ? "animate-glow-pulse" : "";

    return (
      <button
        ref={ref}
        className={`
          ${baseStyles}
          ${variantStyles[variant]}
          ${sizeStyles[size]}
          ${glowStyles}
          ${className}
        `}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? (
          <LoadingSpinner size={size} />
        ) : (
          <>
            {icon && iconPosition === "left" && <span className="flex-shrink-0">{icon}</span>}
            {children && <span>{children}</span>}
            {icon && iconPosition === "right" && <span className="flex-shrink-0">{icon}</span>}
          </>
        )}
      </button>
    );
  },
);

PopButton.displayName = "PopButton";

// かわいいローディングスピナー
function LoadingSpinner({ size }: { size: ButtonSize }) {
  const spinnerSize = {
    sm: "w-3 h-3",
    md: "w-4 h-4",
    lg: "w-5 h-5",
  };

  return (
    <svg className={`animate-spin ${spinnerSize[size]}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

export default PopButton;
