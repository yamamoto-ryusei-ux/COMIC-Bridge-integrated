import { HTMLAttributes, forwardRef, useEffect } from "react";
import { createPortal } from "react-dom";

interface ModalProps extends HTMLAttributes<HTMLDivElement> {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  size?: "sm" | "md" | "lg" | "xl" | "2xl" | "3xl";
  showCloseButton?: boolean;
}

const sizeStyles = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-3xl",
  "3xl": "max-w-4xl",
};

export const Modal = forwardRef<HTMLDivElement, ModalProps>(
  (
    {
      isOpen,
      onClose,
      title,
      size = "md",
      showCloseButton = true,
      className = "",
      children,
      ...props
    },
    ref,
  ) => {
    // ESCキーで閉じる
    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape" && isOpen) {
          onClose();
        }
      };

      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }, [isOpen, onClose]);

    // スクロール無効化
    useEffect(() => {
      if (isOpen) {
        document.body.style.overflow = "hidden";
      } else {
        document.body.style.overflow = "";
      }
      return () => {
        document.body.style.overflow = "";
      };
    }, [isOpen]);

    if (!isOpen) return null;

    const modalContent = (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
        {/* オーバーレイ */}
        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

        {/* モーダル本体 */}
        <div
          ref={ref}
          className={`
            relative w-full ${sizeStyles[size]}
            bg-bg-secondary rounded-3xl
            border border-border
            shadow-elevated
            animate-slide-up
            ${className}
          `}
          onClick={(e) => e.stopPropagation()}
          {...props}
        >
          {/* ヘッダー */}
          {(title || showCloseButton) && (
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              {title && (
                <h2 className="text-lg font-display font-medium text-text-primary">{title}</h2>
              )}
              {showCloseButton && (
                <button
                  onClick={onClose}
                  className="
                    p-1.5 rounded-lg
                    text-text-muted hover:text-text-primary
                    hover:bg-bg-tertiary
                    transition-colors
                  "
                >
                  <CloseIcon />
                </button>
              )}
            </div>
          )}

          {/* コンテンツ */}
          <div className="p-6">{children}</div>
        </div>
      </div>
    );

    return createPortal(modalContent, document.body);
  },
);

Modal.displayName = "Modal";

function CloseIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export default Modal;
