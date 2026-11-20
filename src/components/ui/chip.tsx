import type { ButtonHTMLAttributes, HTMLAttributes } from "react";
import styles from "./chip.module.css";
import { cx } from "./cx";

export type ChipVariant = "neutral" | "accent" | "success" | "danger";

export type ChipProps = HTMLAttributes<HTMLSpanElement> & { variant?: ChipVariant };

/** Static badge: a status, a tag, a category. Meaning must also be in its text, not only the color. */
export function Chip({ variant = "neutral", className, ...rest }: ChipProps) {
  return <span {...rest} className={cx(styles.root, className)} data-variant={variant} />;
}

export type ChipButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-pressed"> & {
  selected: boolean;
  size?: "md" | "lg";
};

/** Toggle chip, e.g. chart series switches. State is exposed through aria-pressed. */
export function ChipButton({ selected, size = "md", type = "button", className, ...rest }: ChipButtonProps) {
  return <button {...rest} type={type} aria-pressed={selected} className={cx(styles.root, className)} data-variant="neutral" data-size={size} />;
}
