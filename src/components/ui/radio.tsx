import type { InputHTMLAttributes, ReactNode } from "react";
import styles from "./check.module.css";
import { cx } from "./cx";
import { useFieldIds } from "./field";

export type RadioProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> & {
  label: ReactNode;
  description?: ReactNode;
};

/** One radio button. Group them with the same `name` inside a <fieldset><legend>. */
export function Radio({ label, description, id, className, disabled, ...rest }: RadioProps) {
  const ids = useFieldIds(id, description, undefined);
  return (
    <div className={cx(styles.root, className)} data-disabled={disabled || undefined}>
      <label className={styles.row} htmlFor={ids.fieldId}>
        <input {...rest} {...ids.controlProps} className={styles.input} type="radio" disabled={disabled} />
        <span className={styles.text}>{label}</span>
      </label>
      {description ? <p className={styles.description} id={ids.hintId}>{description}</p> : null}
    </div>
  );
}
