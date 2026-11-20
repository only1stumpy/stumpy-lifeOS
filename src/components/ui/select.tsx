import type { SelectHTMLAttributes } from "react";
import { cx } from "./cx";
import { Field, useFieldIds, type FieldChrome } from "./field";
import styles from "./field.module.css";

export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> & FieldChrome;

/** Native select: the platform picker stays, only the look (chevron with padding) is ours. Pass <option> children. */
export function Select({ label, hint, error, id, className, required, children, ...rest }: SelectProps) {
  const ids = useFieldIds(id, hint, error);
  const select = (
    <select {...rest} {...ids.controlProps} required={required} className={cx(styles.control, styles.select, !label && !hint && !error && className)}>
      {children}
    </select>
  );
  if (!label && !hint && !error) return select;
  return (
    <Field fieldId={ids.fieldId} label={label} required={required} hint={hint} hintId={ids.hintId} error={error} errorId={ids.errorId} className={className}>
      {select}
    </Field>
  );
}
