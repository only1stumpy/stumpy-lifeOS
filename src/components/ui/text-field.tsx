import type { InputHTMLAttributes } from "react";
import { cx } from "./cx";
import { Field, useFieldIds, type FieldChrome } from "./field";
import styles from "./field.module.css";

export type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & FieldChrome;

/** Native input with label, hint and error. Without label/hint/error it renders the bare input (give it aria-label). */
export function TextField({ label, hint, error, id, className, required, type = "text", ...rest }: TextFieldProps) {
  const ids = useFieldIds(id, hint, error);
  const input = <input {...rest} {...ids.controlProps} type={type} required={required} className={cx(styles.control, !label && !hint && !error && className)} />;
  if (!label && !hint && !error) return input;
  return (
    <Field fieldId={ids.fieldId} label={label} required={required} hint={hint} hintId={ids.hintId} error={error} errorId={ids.errorId} className={className}>
      {input}
    </Field>
  );
}
