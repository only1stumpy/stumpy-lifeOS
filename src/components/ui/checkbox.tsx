import type { InputHTMLAttributes, ReactNode } from "react";
import styles from "./check.module.css";
import { cx } from "./cx";
import { useFieldIds } from "./field";

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> & {
  /** Visible text; the whole row is the label, so it is the accessible name. */
  label: ReactNode;
  /** Explanation under the row. Lives outside the label and is linked through aria-describedby. */
  description?: ReactNode;
  error?: ReactNode;
};

export function Checkbox({ label, description, error, id, className, disabled, ...rest }: CheckboxProps) {
  const ids = useFieldIds(id, description, error);
  return (
    <div className={cx(styles.root, className)} data-disabled={disabled || undefined}>
      <label className={styles.row} htmlFor={ids.fieldId}>
        <input {...rest} {...ids.controlProps} className={styles.input} type="checkbox" disabled={disabled} />
        <span className={styles.text}>{label}</span>
      </label>
      {description ? <p className={styles.description} id={ids.hintId}>{description}</p> : null}
      {error ? <p className={cx(styles.description, styles.error)} id={ids.errorId} role="alert">{error}</p> : null}
    </div>
  );
}
