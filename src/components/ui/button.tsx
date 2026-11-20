import type { ButtonHTMLAttributes } from "react";
import styles from "./button.module.css";
import { cx } from "./cx";

export type ButtonVariant = "primary" | "secondary" | "danger" | "danger-solid" | "text";
export type ButtonSize = "sm" | "md" | "lg";

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "disabled"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, keeps the label, and makes the button inert. Announced through aria-busy. */
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
};

/** Pure function: tests call it directly, no DOM needed. */
export function Button({ variant = "secondary", size = "md", loading = false, disabled = false, fullWidth = false, type = "button", className, onClick, children, ...rest }: ButtonProps) {
  const inert = disabled || loading;
  return (
    <button
      {...rest}
      type={type}
      className={cx(styles.root, className)}
      data-variant={variant}
      data-size={size}
      data-full-width={fullWidth || undefined}
      aria-busy={loading || undefined}
      disabled={inert}
      onClick={inert ? undefined : onClick}
    >
      {children}
    </button>
  );
}
