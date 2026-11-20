"use client";

import { useId, useState } from "react";
import { COMMON_CURRENCIES, normalizeCurrencyCode } from "@/domain/currencies";
import { ChoiceCard, TextField } from "@/components/ui";
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
        {COMMON_CURRENCIES.map((item) => (
          <ChoiceCard key={item.code} mode="single" name={name} checked={!customOpen && value === item.code} onChange={() => pick(item.code)} title={item.code} description={item.name} />
        ))}
        <ChoiceCard className={styles.other} mode="single" name={name} checked={customOpen} onChange={openCustom} title="Другая валюта" />
      </div>
      {customOpen && (
        <TextField
          label="Код валюты"
          value={customText}
          onChange={(event) => editCustom(event.target.value)}
          maxLength={5}
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="PRB"
          hint="Например, PRB — рубль ПМР. От 3 до 5 латинских букв."
        />
      )}
    </fieldset>
  );
}
