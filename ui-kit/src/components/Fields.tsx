import { forwardRef, useId } from "react";
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, ReactNode } from "react";

export interface FieldDecoration { label: string; hint?: ReactNode; error?: string; id?: string }
function descriptionIds(id: string, hint?: ReactNode, error?: string, extra?: string) {
  return [extra, hint ? `${id}-hint` : undefined, error ? `${id}-error` : undefined].filter(Boolean).join(" ") || undefined;
}
function FieldFrame({ id, label, hint, error, children, required }: FieldDecoration & { id: string; children: ReactNode; required?: boolean }) {
  return <div className="gc-field" data-invalid={Boolean(error) || undefined}>
    <label htmlFor={id} className="gc-field__label">{label}{required ? <span aria-hidden="true"> *</span> : null}</label>
    {children}
    {hint ? <div id={`${id}-hint`} className="gc-field__hint">{hint}</div> : null}
    {error ? <div id={`${id}-error`} className="gc-field__error" role="alert">{error}</div> : null}
  </div>;
}
export interface TextFieldProps extends FieldDecoration, Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "size"> {}
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField({ id, label, hint, error, className = "", "aria-describedby": describedBy, ...props }, ref) {
  const generated = useId(); const inputId = id ?? generated;
  return <FieldFrame id={inputId} label={label} hint={hint} error={error} required={props.required}>
    <input {...props} id={inputId} ref={ref} className={`gc-input ${className}`} aria-invalid={Boolean(error) || undefined} aria-describedby={descriptionIds(inputId, hint, error, describedBy)} />
  </FieldFrame>;
});
export interface TextAreaProps extends FieldDecoration, Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> {}
export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea({ id, label, hint, error, className = "", "aria-describedby": describedBy, rows = 4, ...props }, ref) {
  const generated = useId(); const inputId = id ?? generated;
  return <FieldFrame id={inputId} label={label} hint={hint} error={error} required={props.required}>
    <textarea {...props} id={inputId} ref={ref} rows={rows} className={`gc-input gc-textarea ${className}`} aria-invalid={Boolean(error) || undefined} aria-describedby={descriptionIds(inputId, hint, error, describedBy)} />
  </FieldFrame>;
});
export interface SelectOption { value: string; label: string; disabled?: boolean }
export interface SelectFieldProps extends FieldDecoration, Omit<SelectHTMLAttributes<HTMLSelectElement>, "id" | "children"> { options: readonly SelectOption[] }
export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField({ id, label, hint, error, options, className = "", "aria-describedby": describedBy, ...props }, ref) {
  const generated = useId(); const inputId = id ?? generated;
  return <FieldFrame id={inputId} label={label} hint={hint} error={error} required={props.required}>
    <select {...props} id={inputId} ref={ref} className={`gc-input gc-select ${className}`} aria-invalid={Boolean(error) || undefined} aria-describedby={descriptionIds(inputId, hint, error, describedBy)}>
      {options.map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
    </select>
  </FieldFrame>;
});
export interface CheckFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "role"> { label: string; hint?: string; switchControl?: boolean }
export const CheckField = forwardRef<HTMLInputElement, CheckFieldProps>(function CheckField({ label, hint, id, className = "", switchControl = false, ...props }, ref) {
  const generated = useId(); const inputId = id ?? generated;
  return <div className={`gc-check-field ${className}`}>
    <input {...props} ref={ref} id={inputId} type="checkbox" role={switchControl ? "switch" : undefined} aria-describedby={hint ? `${inputId}-hint` : props["aria-describedby"]} className={switchControl ? "gc-switch" : "gc-checkbox"} />
    <label htmlFor={inputId}>{label}</label>
    {hint ? <small id={`${inputId}-hint`}>{hint}</small> : null}
  </div>;
});
export interface FormSectionProps { title: string; description?: string; children: ReactNode; actions?: ReactNode }
export function FormSection({ title, description, children, actions }: FormSectionProps) {
  return <fieldset className="gc-form-section"><legend>{title}</legend>{description ? <p className="gc-muted">{description}</p> : null}<div className="gc-form-grid">{children}</div>{actions ? <div className="gc-form-actions">{actions}</div> : null}</fieldset>;
}
