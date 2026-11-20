import type { ButtonHTMLAttributes } from "react";
import styles from "./button.module.css";
import { cx } from "./cx";
import type { ButtonVariant } from "./button";

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "disabled" | "aria-label"> & {
  /** Accessible name; an icon button has no visible text. */
  label: string;
  variant?: ButtonVariant;
  size?: "sm" | "md";
  disabled?: boolean;
  loading?: boolean;
};

export function IconButton({ label, variant = "secondary", size = "md", loading = false, disabled = false, type = "button", className, onClick, children, ...rest }: IconButtonProps) {
  const inert = disabled || loading;
  return (
    <button
      {...rest}
      type={type}
      aria-label={label}
      className={cx(styles.root, className)}
      data-shape="icon"
      data-variant={variant}
      data-size={size}
      aria-busy={loading || undefined}
      disabled={inert}
      onClick={inert ? undefined : onClick}
    >
      {children}
    </button>
  );
}
