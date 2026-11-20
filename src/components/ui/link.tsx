import type { AnchorHTMLAttributes } from "react";
import { cx } from "./cx";
import styles from "./link.module.css";

export type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: "accent" | "plain";
  /** Opens in a new tab with a safe rel. */
  external?: boolean;
};

export function Link({ variant = "accent", external = false, className, ...rest }: LinkProps) {
  return <a {...rest} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})} className={cx(styles.root, className)} data-variant={variant} />;
}
