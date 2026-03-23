import { HTMLAttributes, forwardRef } from "react";

type GlowColor = "pink" | "purple" | "mint" | "none";

interface GlowCardProps extends HTMLAttributes<HTMLDivElement> {
  selected?: boolean;
  hoverable?: boolean;
  glowColor?: GlowColor;
  padding?: "none" | "sm" | "md" | "lg";
}

const glowColors: Record<GlowColor, string> = {
  pink: "hover:shadow-[0_0_25px_rgba(255,107,157,0.2)]",
  purple: "hover:shadow-[0_0_25px_rgba(124,92,255,0.2)]",
  mint: "hover:shadow-[0_0_25px_rgba(0,212,170,0.2)]",
  none: "",
};

const paddingSizes = {
  none: "",
  sm: "p-2",
  md: "p-4",
  lg: "p-6",
};

export const GlowCard = forwardRef<HTMLDivElement, GlowCardProps>(
  (
    {
      selected = false,
      hoverable = true,
      glowColor = "pink",
      padding = "md",
      className = "",
      children,
      ...props
    },
    ref,
  ) => {
    const baseStyles = `
      bg-bg-tertiary rounded-xl
      border transition-all duration-300
    `;

    const hoverStyles = hoverable
      ? `
        hover:border-accent/30
        hover:-translate-y-0.5
        ${glowColors[glowColor]}
      `
      : "";

    const selectedStyles = selected
      ? `
        border-accent
        shadow-[0_0_20px_rgba(255,107,157,0.25)]
      `
      : "border-white/5";

    return (
      <div
        ref={ref}
        className={`
          ${baseStyles}
          ${hoverStyles}
          ${selectedStyles}
          ${paddingSizes[padding]}
          ${className}
        `}
        {...props}
      >
        {children}
      </div>
    );
  },
);

GlowCard.displayName = "GlowCard";

export default GlowCard;
