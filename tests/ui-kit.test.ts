import assert from "node:assert/strict";
import test, { before } from "node:test";
import "./helpers/css-modules";
import { createElement as h, isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

type Kit = typeof import("../src/components/ui");
let ChoiceCard: Kit["ChoiceCard"], Button: Kit["Button"], Checkbox: Kit["Checkbox"], IconButton: Kit["IconButton"], TextField: Kit["TextField"], Select: Kit["Select"];
// The package is CommonJS for tests, so the kit (ESM-style imports, CSS Modules) is loaded in a hook, not at the top level.
before(async () => {
  ({ ChoiceCard, Button, Checkbox, IconButton, TextField, Select } = await import("../src/components/ui"));
});

type ButtonLike = ReactElement<{ onClick?: () => void; disabled?: boolean; "aria-busy"?: boolean }>;

// Button is a pure function: what it returns is what React would attach to the DOM node.
function rendered(element: unknown): ButtonLike {
  assert.ok(isValidElement(element));
  return element as ButtonLike;
}

test("кнопка в состояниях disabled и loading не передаёт onClick в DOM", () => {
  const onClick = () => undefined;
  assert.equal(rendered(Button({ onClick, children: "ok" })).props.onClick, onClick);
  const disabled = rendered(Button({ onClick, disabled: true, children: "ok" }));
  assert.equal(disabled.props.onClick, undefined);
  assert.equal(disabled.props.disabled, true);
  const loading = rendered(Button({ onClick, loading: true, children: "ok" }));
  assert.equal(loading.props.onClick, undefined);
  assert.equal(loading.props.disabled, true);
  assert.equal(loading.props["aria-busy"], true);
  const icon = rendered(IconButton({ onClick, loading: true, label: "Закрыть", children: "x" }));
  assert.equal(icon.props.onClick, undefined);
});

test("кнопка по умолчанию не отправляет форму", () => {
  assert.match(renderToStaticMarkup(h(Button, null, "Дальше")), /type="button"/);
  assert.match(renderToStaticMarkup(h(Button, { type: "submit" }, "Записать")), /type="submit"/);
});

test("иконочная кнопка получает имя из label", () => {
  assert.match(renderToStaticMarkup(h(IconButton, { label: "Закрыть" }, "x")), /aria-label="Закрыть"/);
});

// A label that points at a different id than the control breaks screen readers and tap-to-focus.
function idOf(markup: string, tag: string) {
  return markup.match(new RegExp(`<${tag}[^>]* id="([^"]+)"`))?.[1];
}

test("Checkbox связывает подпись и поле, пояснение вне label", () => {
  const markup = renderToStaticMarkup(h(Checkbox, { label: "Напоминать", description: "Раз в неделю" }));
  const id = idOf(markup, "input");
  assert.ok(id);
  assert.match(markup, new RegExp(`<label[^>]* for="${id}"`));
  const describedBy = markup.match(/aria-describedby="([^"]+)"/)?.[1];
  assert.ok(describedBy);
  assert.match(markup, new RegExp(`<p[^>]* id="${describedBy}"[^>]*>Раз в неделю</p>`));
  assert.doesNotMatch(markup, /<label[^>]*>[^]*Раз в неделю[^]*<\/label>/);
});

test("поле: подпись, пояснение и ошибка связаны, ошибка помечает поле невалидным", () => {
  const markup = renderToStaticMarkup(h(TextField, { label: "Сумма", hint: "Только число", error: "Введите число" }));
  const id = idOf(markup, "input");
  assert.ok(id);
  assert.match(markup, new RegExp(`<label[^>]* for="${id}"`));
  assert.match(markup, new RegExp(`aria-describedby="${id}-hint ${id}-error"`));
  assert.match(markup, /aria-invalid="true"/);
  assert.match(markup, new RegExp(`id="${id}-error"[^>]*role="alert"`));
  const valid = renderToStaticMarkup(h(TextField, { label: "Сумма" }));
  assert.doesNotMatch(valid, /aria-invalid|aria-describedby/);
});

test("Select несёт тот же контракт подписи и сохраняет options", () => {
  const markup = renderToStaticMarkup(h(Select, { label: "Валюта", error: "Выберите" }, h("option", { value: "USD" }, "USD")));
  const id = idOf(markup, "select");
  assert.ok(id);
  assert.match(markup, new RegExp(`<label[^>]* for="${id}"`));
  assert.match(markup, /<option value="USD">USD<\/option>/);
});

test("галерея /ui отвечает 404 в production и открыта в разработке и на Preview", async () => {
  const { isGalleryEnabled } = await import("../src/components/ui/gallery-access");
  assert.equal(isGalleryEnabled({ VERCEL_ENV: "production" }), false);
  assert.equal(isGalleryEnabled({ VERCEL_ENV: "preview" }), true);
  assert.equal(isGalleryEnabled({}), true);

  const { default: Page } = await import("../src/app/ui/page");
  const before = process.env.VERCEL_ENV;
  try {
    process.env.VERCEL_ENV = "production";
    assert.throws(() => Page(), (error: { digest?: string }) => String(error.digest).startsWith("NEXT_HTTP_ERROR_FALLBACK;404") || error.digest === "NEXT_NOT_FOUND");
    process.env.VERCEL_ENV = "preview";
    assert.ok(isValidElement(Page()));
  } finally {
    if (before === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = before;
  }
});

test("ChoiceCard: multiple — нативный checkbox, single — нативный radio, вся карточка это label", () => {
  const multiple = renderToStaticMarkup(h(ChoiceCard, { mode: "multiple", title: "Питание", description: "КБЖУ", defaultChecked: true }));
  assert.match(multiple, /type="checkbox"/);
  assert.match(multiple, /checked=""/);
  const single = renderToStaticMarkup(h(ChoiceCard, { mode: "single", name: "usage", title: "Каждый день" }));
  assert.match(single, /type="radio"/);
  assert.match(single, /name="usage"/);
  assert.doesNotMatch(single, /checked/);
  // The label points at the input, so a tap anywhere on the card toggles it.
  assert.equal(idOf(single, "label") === undefined, true);
  assert.equal(single.match(/for="([^"]+)"/)?.[1], idOf(single, "input"));
});

test("ChoiceCard: disabled блокирует нативный input и помечает карточку", () => {
  const markup = renderToStaticMarkup(h(ChoiceCard, { mode: "multiple", title: "Зал", disabled: true }));
  assert.match(markup, /disabled=""/);
  assert.match(markup, /data-disabled="true"/);
  assert.match(markup, /aria-hidden="true"/);
});
