import { useState, useRef, useEffect, ReactNode } from "react";
import { createPortal } from "react-dom";

type TooltipPosition = "top" | "bottom" | "left" | "right";

interface TooltipProps {
  content: ReactNode;
  position?: TooltipPosition;
  delay?: number;
  children: ReactNode;
}

export function Tooltip({ content, position = "top", delay = 200, children }: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<number>();

  const showTooltip = () => {
    timeoutRef.current = window.setTimeout(() => {
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = position === "top" ? rect.top : rect.bottom;
        setCoords({ x, y });
        setIsVisible(true);
      }
    }, delay);
  };

  const hideTooltip = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setIsVisible(false);
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const positionStyles: Record<TooltipPosition, string> = {
    top: "-translate-x-1/2 -translate-y-full mb-2",
    bottom: "-translate-x-1/2 mt-2",
    left: "-translate-x-full -translate-y-1/2 mr-2",
    right: "translate-y-[-50%] ml-2",
  };

  const getTooltipStyle = () => {
    switch (position) {
      case "top":
        return { left: coords.x, top: coords.y - 8 };
      case "bottom":
        return { left: coords.x, top: coords.y + 8 };
      case "left":
        return { left: coords.x - 8, top: coords.y };
      case "right":
        return { left: coords.x + 8, top: coords.y };
    }
  };

  return (
    <>
      <div
        ref={triggerRef}
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        onFocus={showTooltip}
        onBlur={hideTooltip}
      >
        {children}
      </div>
      {isVisible &&
        createPortal(
          <div
            className={`
              fixed z-[100]
              px-3 py-1.5 text-sm
              bg-bg-elevated text-text-primary
              border border-white/10
              rounded-lg shadow-lg
              animate-slide-up
              pointer-events-none
              ${positionStyles[position]}
            `}
            style={getTooltipStyle()}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}

export default Tooltip;
