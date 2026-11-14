"use client";

import { useId, useState } from "react";
import { COMMON_CURRENCIES, normalizeCurrencyCode } from "@/domain/currencies";
import styles from "./currency-picker.module.css";

type Props = {
  /** Valid normalized code, or "" when nothing (valid) is selected. */
  value: string;
  onChange(code: string): void;
  legend?: string;
};

const isCommon = (code: string) => COMMON_CURRENCIES.some((item) => item.code === code);

export function CurrencyPicker({ value, onChange, legend = "Валюта" }: Props) {
  const name = useId();
  const [customOpen, setCustomOpen] = useState(() => value !== "" && !isCommon(value));
  const [customText, setCustomText] = useState(() => (value !== "" && !isCommon(value) ? value : ""));

  function pick(code: string) {
    setCustomOpen(false);
    onChange(code);
  }

  function openCustom() {
    setCustomOpen(true);
    onChange(normalizeCurrencyCode(customText) ?? "");
  }

  function editCustom(raw: string) {
    const text = raw.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 5);
    setCustomText(text);
    onChange(normalizeCurrencyCode(text) ?? "");
  }

  return (
    <fieldset className={styles.picker}>
      <legend className={styles.legend}>{legend}</legend>
      <div className={styles.list}>
        {COMMON_CURRENCIES.map((item) => {
          const on = !customOpen && value === item.code;
          return (
            <label key={item.code} className={`${styles.chip} ${on ? styles.selected : ""}`}>
              <input type="radio" name={name} checked={on} onChange={() => pick(item.code)} />
              <span className={styles.code}>{item.code}</span>
              <span className={styles.name}>{item.name}</span>
            </label>
          );
        })}
        <label className={`${styles.chip} ${styles.other} ${customOpen ? styles.selected : ""}`}>
          <input type="radio" name={name} checked={customOpen} onChange={openCustom} />
          <span className={styles.code}>Другая валюта</span>
        </label>
      </div>
      {customOpen && (
        <label className={styles.custom}>
          Код валюты
          <input
            value={customText}
            onChange={(event) => editCustom(event.target.value)}
            maxLength={5}
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="PRB"
            aria-describedby={`${name}-help`}
          />
          <small id={`${name}-help`}>Например, PRB — рубль ПМР. От 3 до 5 латинских букв.</small>
        </label>
      )}
    </fieldset>
  );
}
