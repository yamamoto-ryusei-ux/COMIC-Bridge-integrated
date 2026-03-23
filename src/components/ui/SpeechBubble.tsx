import { HTMLAttributes, forwardRef } from "react";

type BubbleVariant = "default" | "success" | "warning" | "error" | "info";
type TailPosition =
  | "bottom-left"
  | "bottom-center"
  | "bottom-right"
  | "top-left"
  | "top-center"
  | "top-right";

interface SpeechBubbleProps extends HTMLAttributes<HTMLDivElement> {
  variant?: BubbleVariant;
  tailPosition?: TailPosition;
  showTail?: boolean;
  animate?: boolean;
}

const variantStyles: Record<BubbleVariant, { bg: string; border: string; text: string }> = {
  default: {
    bg: "bg-bg-elevated",
    border: "border-white/10",
    text: "text-text-primary",
  },
  success: {
    bg: "bg-success/10",
    border: "border-success/30",
    text: "text-success",
  },
  warning: {
    bg: "bg-warning/10",
    border: "border-warning/30",
    text: "text-warning",
  },
  error: {
    bg: "bg-error/10",
    border: "border-error/30",
    text: "text-error",
  },
  info: {
    bg: "bg-accent/10",
    border: "border-accent/30",
    text: "text-accent",
  },
};

const tailPositions: Record<TailPosition, string> = {
  "bottom-left": "bottom-0 left-4 translate-y-1/2 rotate-45",
  "bottom-center": "bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 rotate-45",
  "bottom-right": "bottom-0 right-4 translate-y-1/2 rotate-45",
  "top-left": "top-0 left-4 -translate-y-1/2 rotate-45",
  "top-center": "top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 rotate-45",
  "top-right": "top-0 right-4 -translate-y-1/2 rotate-45",
};

export const SpeechBubble = forwardRef<HTMLDivElement, SpeechBubbleProps>(
  (
    {
      variant = "default",
      tailPosition = "bottom-left",
      showTail = true,
      animate = true,
      className = "",
      children,
      ...props
    },
    ref,
  ) => {
    const styles = variantStyles[variant];

    return (
      <div
        ref={ref}
        className={`
          relative
          ${styles.bg} ${styles.border} ${styles.text}
          border rounded-2xl px-4 py-3
          shadow-lg
          ${animate ? "animate-slide-up" : ""}
          ${className}
        `}
        {...props}
      >
        {children}
        {showTail && (
          <div
            className={`
              absolute w-3 h-3
              ${styles.bg}
              border-r border-b ${styles.border}
              ${tailPositions[tailPosition]}
            `}
          />
        )}
      </div>
    );
  },
);

SpeechBubble.displayName = "SpeechBubble";

export default SpeechBubble;
