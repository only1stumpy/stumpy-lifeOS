import type { TextareaHTMLAttributes } from "react";
import { cx } from "./cx";
import { Field, useFieldIds, type FieldChrome } from "./field";
import styles from "./field.module.css";

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & FieldChrome;

export function Textarea({ label, hint, error, id, className, required, ...rest }: TextareaProps) {
  const ids = useFieldIds(id, hint, error);
  const area = <textarea {...rest} {...ids.controlProps} required={required} className={cx(styles.control, styles.textarea, !label && !hint && !error && className)} />;
  if (!label && !hint && !error) return area;
  return (
    <Field fieldId={ids.fieldId} label={label} required={required} hint={hint} hintId={ids.hintId} error={error} errorId={ids.errorId} className={className}>
      {area}
    </Field>
  );
}
