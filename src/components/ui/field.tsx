import { useId, type ReactNode } from "react";
import styles from "./field.module.css";

/** Ids that tie a control to its label, hint and error. Controls spread `controlProps` onto the native element. */
export function useFieldIds(id: string | undefined, hint: ReactNode, error: ReactNode) {
  const generated = useId();
  const fieldId = id ?? generated;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return {
    fieldId,
    hintId,
    errorId,
    controlProps: { id: fieldId, "aria-describedby": describedBy, "aria-invalid": error ? (true as const) : undefined },
  };
}

export type FieldProps = {
  /** Same id the control uses; the label points at it through htmlFor. */
  fieldId: string;
  label?: ReactNode;
  required?: boolean;
  hint?: ReactNode;
  hintId?: string;
  error?: ReactNode;
  errorId?: string;
  className?: string;
  children: ReactNode;
};

/** Label above, control, then hint and error as separate paragraphs (outside the label, so they are not read twice). */
export function Field({ fieldId, label, required, hint, hintId, error, errorId, className, children }: FieldProps) {
  return (
    <div className={[styles.field, className].filter(Boolean).join(" ")}>
      {label ? (
        <label className={styles.label} htmlFor={fieldId}>
          {label}
          {required ? <span className={styles.required} aria-hidden="true"> *</span> : null}
        </label>
      ) : null}
      {children}
      {hint ? <p className={styles.hint} id={hintId}>{hint}</p> : null}
      {error ? <p className={styles.error} id={errorId} role="alert">{error}</p> : null}
    </div>
  );
}

export type FieldChrome = {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
};
