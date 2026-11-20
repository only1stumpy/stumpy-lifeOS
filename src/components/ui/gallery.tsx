import type { ReactNode } from "react";
import { Button, Checkbox, ChoiceCard, Chip, ChipButton, IconButton, Link, Radio, Select, TextField, Textarea, tokens, type ButtonSize, type ButtonVariant } from "./index";
import styles from "./gallery.module.css";

const variants: ButtonVariant[] = ["primary", "secondary", "danger", "danger-solid", "text"];
const sizes: ButtonSize[] = ["sm", "md", "lg"];

const PlusIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
);
const CloseIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
);

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>{title}</h2>
      {note ? <p className={styles.caption}>{note}</p> : null}
      {children}
    </section>
  );
}

/** Every kit component in every state, at 390px. Server component: the same markup a report would render. */
export function UiGallery() {
  return (
    <main className={styles.page}>
      <div className={styles.inner}>
        <header className={styles.stack}>
          <h1 className={styles.title}>UI-кит</h1>
          <p className={styles.lead}>Компоненты и состояния Mini App. Страница доступна только в разработке и на Preview. Фокус проверяйте клавишей Tab, нажатие и наведение, касанием.</p>
        </header>

        <Section title="Button" note="primary, secondary, danger, text; размеры sm 44, md 48, lg 52.">
          {variants.map((variant) => (
            <div className={styles.row} key={variant}>
              {sizes.map((size) => <Button key={size} variant={variant} size={size}>{variant} {size}</Button>)}
            </div>
          ))}
          <p className={styles.caption}>Состояния: обычная, disabled, loading.</p>
          {variants.map((variant) => (
            <div className={styles.row} key={variant}>
              <Button variant={variant}>Записать</Button>
              <Button variant={variant} disabled>Недоступно</Button>
              <Button variant={variant} loading>Сохраняем</Button>
            </div>
          ))}
          <p className={styles.caption}>fullWidth и длинная подпись.</p>
          <Button variant="primary" size="lg" fullWidth>Сохранить изменения</Button>
          <Button fullWidth>Очень длинная подпись кнопки, которая переносится на вторую строку внутри поверхности</Button>
        </Section>

        <Section title="IconButton" note="Круг, имя через aria-label; размеры sm 44, md 48.">
          <div className={styles.row}>
            <IconButton label="Добавить" variant="primary"><PlusIcon /></IconButton>
            <IconButton label="Закрыть"><CloseIcon /></IconButton>
            <IconButton label="Закрыть" size="sm"><CloseIcon /></IconButton>
            <IconButton label="Удалить" variant="danger"><CloseIcon /></IconButton>
            <IconButton label="Недоступно" disabled><PlusIcon /></IconButton>
            <IconButton label="Загрузка" loading><PlusIcon /></IconButton>
          </div>
        </Section>

        <Section title="Checkbox" note="Подпись внутри label, пояснение снаружи и связано через aria-describedby.">
          <div className={styles.stack}>
            <Checkbox label="Напоминать о весе" />
            <Checkbox label="Включено" defaultChecked />
            <Checkbox label="С пояснением" description="Присылаем раз в неделю, в выбранное время." defaultChecked />
            <Checkbox label="Недоступно" disabled />
            <Checkbox label="Недоступно, включено" disabled defaultChecked />
            <Checkbox label="Принимаю условия" error="Без согласия продолжить нельзя." />
          </div>
        </Section>

        <Section title="Radio">
          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>Единицы массы</legend>
            <Radio name="gallery-unit" label="Килограммы" defaultChecked />
            <Radio name="gallery-unit" label="Фунты" description="Пересчитывается при вводе." />
            <Radio name="gallery-unit" label="Недоступно" disabled />
          </fieldset>
        </Section>

        <Section title="ChoiceCard" note="Карточка-выбор: нативный checkbox (multiple) или radio (single), галочка в углу. Тап по всей карточке.">
          <div className={styles.stack}>
            <ChoiceCard mode="multiple" title="Питание" description="Калории, белки, жиры, углеводы." />
            <ChoiceCard mode="multiple" title="Финансы" description="Счета, расходы, долги." defaultChecked />
            <ChoiceCard mode="multiple" title="Зал" description="Недоступно." disabled />
            <ChoiceCard mode="multiple" title="Зал, выбрано" description="Недоступно, включено." disabled defaultChecked />
          </div>
          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>Как часто заходишь</legend>
            <div className={styles.stack}>
              <ChoiceCard mode="single" name="gallery-usage" title="Каждый день" description="Напоминания и ежедневная сводка." defaultChecked />
              <ChoiceCard mode="single" name="gallery-usage" title="Иногда" description="Только важное." />
              <ChoiceCard mode="single" name="gallery-usage" title="Недоступно" description="Нельзя выбрать." disabled />
            </div>
          </fieldset>
        </Section>

        <Section title="TextField">
          <div className={styles.stack}>
            <TextField label="Название" placeholder="Например, Касса" />
            <TextField label="Сумма" hint="Только число, без пробелов." inputMode="decimal" defaultValue="1500" />
            <TextField label="Ошибка" defaultValue="abc" error="Введите число." />
            <TextField label="Недоступно" defaultValue="Только чтение" disabled />
            <TextField label="Обязательное" required placeholder="Не оставляйте пустым" />
            <TextField label="Дата" type="date" defaultValue="2026-11-20" />
            <TextField aria-label="Поле без подписи" placeholder="Поле без подписи (aria-label)" />
          </div>
        </Section>

        <Section title="Textarea">
          <div className={styles.stack}>
            <Textarea label="Заметка" placeholder="Что важно запомнить" hint="До 500 символов." />
            <Textarea label="С ошибкой" defaultValue="..." error="Слишком коротко." />
          </div>
        </Section>

        <Section title="Select" note="Нативный список, своя стрелка с отступом от края.">
          <div className={styles.stack}>
            <Select label="Валюта" defaultValue="PRB">
              <option value="PRB">PRB, рубль ПМР</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </Select>
            <Select label="С подсказкой" hint="Курс вводится вручную.">
              <option>Основная</option>
              <option>Дополнительная</option>
            </Select>
            <Select label="С ошибкой" error="Выберите значение." defaultValue="">
              <option value="" disabled>Не выбрано</option>
              <option value="1">Первый</option>
            </Select>
            <Select label="Недоступно" disabled>
              <option>Только чтение</option>
            </Select>
          </div>
        </Section>

        <Section title="Link">
          <div className={styles.row}>
            <Link href="#gallery">Ссылка в тексте</Link>
            <Link href="https://example.com" external>Внешняя ссылка</Link>
            <Link href="#gallery" variant="plain">Без акцента</Link>
          </div>
        </Section>

        <Section title="Chip" note="Статичный бейдж и переключатель (aria-pressed).">
          <div className={styles.row}>
            <Chip>Нейтральный</Chip>
            <Chip variant="accent">Подписка</Chip>
            <Chip variant="success">Оплачено</Chip>
            <Chip variant="danger">Просрочено</Chip>
          </div>
          <div className={styles.row}>
            <ChipButton selected>Калории</ChipButton>
            <ChipButton selected={false}>Белки</ChipButton>
            <ChipButton selected={false} disabled>Жиры</ChipButton>
          </div>
          <div className={styles.row}>
            <ChipButton selected size="lg">Углеводы</ChipButton>
            <ChipButton selected={false} size="lg">Вес</ChipButton>
          </div>
        </Section>

        <Section title="Токены" note="Цвета из tokens.css; те же значения в tokens.ts.">
          <div className={styles.swatches}>
            {Object.entries(tokens.color).map(([name, value]) => (
              <div className={styles.swatch} key={name}>
                <div className={styles.chipColor} style={{ background: value }} />
                <span>{name}</span>
                <span className={styles.mono}>{value}</span>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </main>
  );
}
