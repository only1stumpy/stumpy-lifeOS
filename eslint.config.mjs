import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const RAW_CONTROL_MESSAGE =
  "Сырой контрол вне src/components/ui/: используйте компонент кита или добавьте eslint-disable с причиной (см. DESIGN.md, «UI-кит»).";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/components/ui/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXOpeningElement[name.name=/^(button|select|textarea)$/]",
          message: RAW_CONTROL_MESSAGE,
        },
        {
          selector:
            "JSXOpeningElement[name.name='input']:has(JSXAttribute[name.name='type'] > Literal[value=/^(checkbox|radio|text)$/])",
          message: RAW_CONTROL_MESSAGE,
        },
      ],
    },
  },
]);
