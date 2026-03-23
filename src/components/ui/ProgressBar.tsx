import { HTMLAttributes, forwardRef } from "react";

type ProgressVariant = "default" | "success" | "warning";
type ProgressSize = "sm" | "md" | "lg";

interface ProgressBarProps extends HTMLAttributes<HTMLDivElement> {
  value: number;
  max?: number;
  variant?: ProgressVariant;
  size?: ProgressSize;
  showLabel?: boolean;
  animated?: boolean;
}

const variantGradients: Record<ProgressVariant, string> = {
  default: "bg-gradient-to-r from-accent to-accent-secondary",
  success: "bg-gradient-to-r from-accent-tertiary to-accent-secondary",
  warning: "bg-gradient-to-r from-accent-warm to-accent",
};

const sizeStyles: Record<ProgressSize, string> = {
  sm: "h-1.5",
  md: "h-2.5",
  lg: "h-4",
};

export const ProgressBar = forwardRef<HTMLDivElement, ProgressBarProps>(
  (
    {
      value,
      max = 100,
      variant = "default",
      size = "md",
      showLabel = false,
      animated = true,
      className = "",
      ...props
    },
    ref,
  ) => {
    const percentage = Math.min(Math.max((value / max) * 100, 0), 100);

    return (
      <div ref={ref} className={className} {...props}>
        {showLabel && (
          <div className="flex justify-between items-center mb-1.5">
            <span className="text-xs text-text-secondary">Progress</span>
            <span className="text-xs font-medium text-text-primary">{Math.round(percentage)}%</span>
          </div>
        )}
        <div className={`bg-bg-tertiary rounded-full overflow-hidden ${sizeStyles[size]}`}>
          <div
            className={`
              h-full rounded-full
              ${variantGradients[variant]}
              transition-all duration-500 ease-out
              ${animated ? "relative overflow-hidden" : ""}
            `}
            style={{ width: `${percentage}%` }}
          >
            {animated && (
              <div
                className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
                style={{
                  animation: "shimmer 2s infinite",
                }}
              />
            )}
          </div>
        </div>
        <style>{`
          @keyframes shimmer {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(100%); }
          }
        `}</style>
      </div>
    );
  },
);

ProgressBar.displayName = "ProgressBar";

export default ProgressBar;
