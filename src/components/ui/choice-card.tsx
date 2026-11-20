import type { InputHTMLAttributes, ReactNode } from "react";
import styles from "./choice-card.module.css";
import { cx } from "./cx";
import { useFieldIds } from "./field";

export type ChoiceCardProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size" | "title"> & {
  /** `multiple` is a native checkbox (any number selected), `single` a native radio (give the group one `name`). */
  mode: "single" | "multiple";
  title: ReactNode;
  description?: ReactNode;
};

/**
 * A tappable card that is a real checkbox or radio: the whole card is the label, the corner mark shows the state.
 * Group `single` cards inside a <fieldset><legend>. Selected = accent frame and filled check; not selected = empty ring.
 */
export function ChoiceCard({ mode, title, description, id, className, disabled, ...rest }: ChoiceCardProps) {
  const ids = useFieldIds(id, undefined, undefined);
  return (
    <label className={cx(styles.card, className)} htmlFor={ids.fieldId} data-mode={mode} data-disabled={disabled || undefined}>
      <input {...rest} {...ids.controlProps} className={styles.input} type={mode === "single" ? "radio" : "checkbox"} disabled={disabled} />
      <span className={styles.title}>{title}</span>
      {description ? <span className={styles.description}>{description}</span> : null}
      <span className={styles.mark} aria-hidden="true">
        <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 7.5 2.7 2.7L11 4.5" /></svg>
      </span>
    </label>
  );
}
