// Экраны Mini App, воспроизведённые по раскладке и подписям из src/components/lifeos/*, settings/*, reports/*.
// Единицы — CSS px приложения при ширине 390; окно масштабирует их до кадра.
import React from "react";
import { C, FONT_MONO, FONT_SANS } from "./tokens";
import { appear, camera, lerp, press, sec, sp, tw, type CamKey } from "./anim";
import { Glass } from "./ui";
import { FIN, MONEY, TARGET, type FoodEntry, type MoneyRow } from "./config";

export const APP_W = 390;
const nf = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
export const fmt = (n: number) => nf.format(Math.round(n));
const UNIT = "руб."; // в ролике валюта показана просто как рубли

// ---------- иконки (пути из lifeos-app.tsx) ----------
type IconName = "today" | "nutrition" | "finance" | "gym" | "settings" | "arrow" | "plus" | "edit" | "trash" | "close" | "back" | "check" | "clock";
const PATHS: Record<IconName, React.ReactNode> = {
  today: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></>,
  nutrition: <><path d="M7 3v6M4.5 3v3.5a2.5 2.5 0 0 0 5 0V3M7 9v12" /><path d="M16.5 3c-1.8 2.1-2.5 4.3-2.5 7v2.5h5V10c0-2.7-.7-4.9-2.5-7Z" /><path d="M16.5 12.5V21" /></>,
  finance: <><rect x="3" y="5.5" width="18" height="14" rx="2.4" /><path d="M3.5 8.5h17M15.5 14h3" /><circle cx="15" cy="14" r=".7" fill="currentColor" stroke="none" /></>,
  gym: <><path d="M5 9v6M8 6.5v11M16 6.5v11M19 9v6M8 12h8" /><path d="M3.5 9v6M20.5 9v6" /></>,
  settings: <><path d="M10.05 4.97 L10.42 2.53 L13.58 2.53 L13.95 4.97 L15.59 5.65 L17.57 4.18 L19.82 6.43 L18.35 8.41 L19.03 10.05 L21.47 10.42 L21.47 13.58 L19.03 13.95 L18.35 15.59 L19.82 17.57 L17.57 19.82 L15.59 18.35 L13.95 19.03 L13.58 21.47 L10.42 21.47 L10.05 19.03 L8.41 18.35 L6.43 19.82 L4.18 17.57 L5.65 15.59 L4.97 13.95 L2.53 13.58 L2.53 10.42 L4.97 10.05 L5.65 8.41 L4.18 6.43 L6.43 4.18 L8.41 5.65 Z" /><circle cx="12" cy="12" r="3" /></>,
  arrow: <path d="M5 19 19 5M8 5h11v11" />,
  plus: <path d="M12 5v14M5 12h14" />,
  edit: <><path d="m4 16.5-.7 4.2 4.2-.7L19.7 7.8a2.1 2.1 0 0 0-3-3L4 16.5Z" /><path d="m14.8 6.7 2.5 2.5" /></>,
  trash: <path d="M4.5 7h15M9 7V4.5h6V7M7 7l.8 13h8.4L17 7M10 10.5v6M14 10.5v6" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  back: <path d="m14.5 5-7 7 7 7M8 12h12" />,
  check: <path d="m5 12.5 4.3 4.3L19 7" />,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.5 2" /></>,
};
export const Icon: React.FC<{ name: IconName; size?: number; style?: React.CSSProperties }> = ({ name, size = 18, style }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.65} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, ...style }}>{PATHS[name]}</svg>
);

// ---------- примитивы ----------
const base: React.CSSProperties = { fontFamily: FONT_SANS, color: C.text };
export const Surface: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <Glass radius={28} style={{ padding: 22, ...style }}>{children}</Glass>
);
const Eyebrow: React.FC<{ children: React.ReactNode }> = ({ children }) => <div style={{ fontSize: 13, color: C.text2, fontWeight: 450 }}>{children}</div>;
const H2: React.FC<{ children: React.ReactNode; size?: number }> = ({ children, size = 21 }) => <div style={{ fontSize: size, fontWeight: 520, letterSpacing: "-0.015em", marginTop: 2 }}>{children}</div>;
const TextLink: React.FC<{ children: React.ReactNode; icon?: IconName; lead?: IconName }> = ({ children, icon, lead }) => (
  <span style={{ color: C.accent, fontSize: 15, fontWeight: 520, display: "inline-flex", alignItems: "center", gap: 5 }}>
    {lead && <Icon name={lead} size={15} />}{children}{icon && <Icon name={icon} size={14} />}
  </span>
);
const Primary: React.FC<{ children: React.ReactNode; style?: React.CSSProperties; scale?: number }> = ({ children, style, scale = 1 }) => (
  <div style={{ height: 52, borderRadius: 999, background: C.accent, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", gap: 7, fontSize: 15.5, fontWeight: 540, padding: "0 20px", boxShadow: "0 8px 20px rgba(116,43,69,.24)", transform: `scale(${scale})`, ...style }}>{children}</div>
);
const Secondary: React.FC<{ children: React.ReactNode; style?: React.CSSProperties; scale?: number }> = ({ children, style, scale = 1 }) => (
  <Glass radius={999} style={{ height: 52, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, fontSize: 15.5, fontWeight: 520, padding: "0 18px", color: C.text, transform: `scale(${scale})`, ...style }}>{children}</Glass>
);
const Divider = () => <div style={{ height: 1, background: C.divider, margin: "20px 0" }} />;
const Bar: React.FC<{ p: number; color: string; h?: number }> = ({ p, color, h = 5 }) => (
  <div style={{ flex: 1, height: h, borderRadius: h, background: C.track, overflow: "hidden" }}>
    <div style={{ height: "100%", width: "100%", background: color, transform: `scaleX(${Math.max(0, Math.min(1, p))})`, transformOrigin: "left center", borderRadius: h }} />
  </div>
);
const Tap: React.FC<{ f: number; at?: number; children: React.ReactNode; radius?: number }> = ({ f, at, children, radius = 999 }) => {
  if (at === undefined) return <>{children}</>;
  const pr = press(f, at);
  return (
    <div style={{ position: "relative", transform: `scale(${pr.scale})` }}>
      {children}
      {pr.ring >= 0 && <div style={{ position: "absolute", inset: -(12 + 10 * pr.ring), borderRadius: radius === 999 ? 999 : radius + 12 + 10 * pr.ring, border: `2px solid rgba(116,43,69,${0.55 * (1 - pr.ring)})`, background: `rgba(116,43,69,${0.08 * (1 - pr.ring)})`, pointerEvents: "none" }} />}
    </div>
  );
};

/** Каскад появления: элемент i появляется через 70 мс после соседа. */
const cas = (f: number, at: number, i: number) => appear(f, at + i * 0.07, 6, 0.32);

export const AppHeader: React.FC<{ date?: string }> = ({ date = "понедельник, 16 ноября" }) => (
  <div style={{ ...base, display: "flex", justifyContent: "space-between", alignItems: "center", height: 40 }}>
    <span style={{ fontSize: 19, fontWeight: 560, letterSpacing: "-0.02em" }}>LifeOS</span>
    <span style={{ fontSize: 13.5, color: C.text2 }}>{date}</span>
  </div>
);
export const PageTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ ...base, fontSize: 38, fontWeight: 460, letterSpacing: "-0.025em", margin: "18px 0 18px" }}>{children}</div>
);

// ---------- питание ----------
export type Macros = { kcal: number; p: number; f: number; c: number };
const CalorieSummary: React.FC<{ m: Macros; compact?: boolean; grow: number }> = ({ m, compact, grow }) => (
  <div>
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: compact ? 10 : 18 }}>
      <span className="tnum" style={{ fontSize: compact ? 50 : 56, fontWeight: 400, letterSpacing: "-0.035em", lineHeight: 1 }}>{fmt(m.kcal)}</span>
      <span style={{ fontSize: 15, color: C.text2 }}>из {fmt(TARGET.kcal)} ккал</span>
    </div>
    <div style={{ display: "flex", marginTop: 14 }}><Bar p={(m.kcal / TARGET.kcal) * grow} color="#6f8a6c" h={6} /></div>
    <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 18 }}>
      {([["Б", m.p, TARGET.p, C.protein, "#7f9a7b"], ["Ж", m.f, TARGET.f, C.fat, "#b88d5e"], ["У", m.c, TARGET.c, C.carbs, "#a77d78"]] as const).map(([l, v, t, col, bar]) => (
        <div key={l} style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ width: 16, fontSize: 14, fontWeight: 560, color: col }}>{l}</span>
          <Bar p={(v / t) * grow} color={bar} />
          <span className="tnum" style={{ fontFamily: FONT_MONO, fontSize: 13.5, minWidth: 96, textAlign: "right" }}>{fmt(v)}<span style={{ color: C.text2 }}> / {t} г</span></span>
        </div>
      ))}
    </div>
    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16, fontSize: 14, color: C.text2 }}>
      <span>Осталось {fmt(Math.max(0, TARGET.kcal - m.kcal))} ккал</span><span>Набрать массу</span>
    </div>
  </div>
);
const ModuleHeading: React.FC<{ title: string; link: string }> = ({ title, link }) => (
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
    <span style={{ fontSize: 21, fontWeight: 520, letterSpacing: "-0.015em" }}>{title}</span>
    <TextLink icon="arrow">{link}</TextLink>
  </div>
);
const InlineEntry: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Glass radius={999} style={{ height: 48, display: "inline-flex", alignItems: "center", gap: 7, padding: "0 18px", marginTop: 18, fontSize: 15, fontWeight: 520, color: C.accent }}><Icon name="plus" size={16} />{children}</Glass>
);
const Stat: React.FC<{ label: string; detail?: string; value: string; unit: string }> = ({ label, detail, value, unit }) => (
  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
    <span style={{ fontSize: 14, color: C.text2 }}>{label}</span>
    {detail && <span style={{ fontSize: 13, color: C.text2, opacity: 0.85 }}>{detail}</span>}
    <span className="tnum" style={{ fontSize: 30, letterSpacing: "-0.03em", marginTop: 4 }}>{value}<small style={{ fontSize: 14, color: C.text2, marginLeft: 6, letterSpacing: 0 }}>{unit}</small></span>
  </div>
);

/** Экран «Сегодня»: одна поверхность, три секции с тонкими разделителями. */
export const TodayScreen: React.FC<{ f: number; at: number; m: Macros; grow: number; balance: number; spent: number; gymOn?: number; tapDiary?: number }> = ({ f, at, m, grow, balance, spent, gymOn = 1 }) => (
  <div style={base}>
    <AppHeader />
    <div style={cas(f, at, 0)}><PageTitle>Сегодня</PageTitle></div>
    <div style={cas(f, at, 1)}>
      <Surface style={{ padding: "24px 22px" }}>
        <div style={cas(f, at, 2)}>
          <ModuleHeading title="Питание" link="Дневник" />
          <CalorieSummary m={m} compact grow={grow} />
          <InlineEntry>Записать еду</InlineEntry>
        </div>
        <Divider />
        <div style={cas(f, at, 3)}>
          <ModuleHeading title="Финансы" link="Операции" />
          <div style={{ display: "flex", gap: 16, marginTop: 16 }}>
            <Stat label="Основной счёт" detail="Зарплатная карта" value={fmt(balance)} unit={UNIT} />
            <Stat label="Потрачено сегодня" value={fmt(spent)} unit={UNIT} />
          </div>
          <InlineEntry>Записать операцию</InlineEntry>
        </div>
        <div style={{ opacity: gymOn, height: 150 * gymOn, overflow: "hidden" }}>
          <Divider />
          <div style={cas(f, at, 4)}>
            <ModuleHeading title="Зал" link="План" />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 14 }}>
              <div><div style={{ fontSize: 22, fontWeight: 480 }}>Верх тела A</div><div style={{ fontSize: 14, color: C.text2, marginTop: 4 }}>5 упражнений</div></div>
              <TextLink icon="arrow">Начать</TextLink>
            </div>
          </div>
        </div>
      </Surface>
    </div>
  </div>
);

const FOOD_ROW_H = 86;
const FoodRow: React.FC<{ e: FoodEntry }> = ({ e }) => (
  <div style={{ display: "flex", gap: 12, alignItems: "flex-start", height: FOOD_ROW_H, paddingTop: 12, borderTop: `1px solid ${C.divider}` }}>
    <span className="tnum" style={{ fontFamily: FONT_MONO, fontSize: 13.5, color: C.text2, width: 44, paddingTop: 2 }}>{e.time}</span>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 16, fontWeight: 520 }}>{e.label}</div>
      <div style={{ fontSize: 12.5, color: C.text2, marginTop: 3, lineHeight: 1.3 }}>{e.portion} · {fmt(e.kcal)} ккал · Б {e.p} / Ж {e.f} / У {e.c} г{e.est ? " · оценка" : ""}</div>
    </div>
    <div style={{ display: "flex", gap: 10, color: C.text2, paddingTop: 2 }}><Icon name="edit" size={17} /><Icon name="trash" size={17} /></div>
  </div>
);
/** Список с layout-анимацией: новая строка встаёт сверху, остальные сдвигаются пружиной. */
function InsertList<T>({ rows, newRow, p, rowH, render }: { rows: T[]; newRow?: T; p: number; rowH: number; render: (r: T) => React.ReactNode }) {
  return (
    <div style={{ position: "relative", height: (rows.length + (newRow ? p : 0)) * rowH }}>
      {newRow && <div style={{ position: "absolute", left: 0, right: 0, top: 0, opacity: Math.max(0, Math.min(1, (p - 0.55) / 0.45)), transform: `translateY(${(1 - p) * -8}px)` }}>{render(newRow)}</div>}
      {rows.map((r, i) => (
        <div key={i} style={{ position: "absolute", left: 0, right: 0, top: (i + (newRow ? p : 0)) * rowH }}>{render(r)}</div>
      ))}
    </div>
  );
}

export const NutritionScreen: React.FC<{
  f: number; at: number; m: Macros; grow: number; entries: FoodEntry[]; newEntry?: FoodEntry; insertP?: number;
  date?: string; tapPrev?: number; tapNext?: number; tapAdd?: number; metric?: number; tapMetricAt?: number; selectDayAt?: number;
}> = ({ f, at, m, grow, entries, newEntry, insertP = 0, date = "понедельник, 16 ноября", tapPrev, tapNext, tapAdd, metric = 0, tapMetricAt, selectDayAt }) => (
  <div style={base}>
    <AppHeader date={date} />
    <div style={cas(f, at, 0)}><PageTitle>Питание</PageTitle></div>
    <div style={cas(f, at, 1)}>
      <Surface>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Tap f={f} at={tapPrev}><Glass radius={999} style={{ width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>‹</Glass></Tap>
          <div style={{ textAlign: "center" }}><Eyebrow>Дневник</Eyebrow><div style={{ fontSize: 17, fontWeight: 520, marginTop: 2 }}>{date}</div></div>
          <Tap f={f} at={tapNext}><Glass radius={999} style={{ width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>›</Glass></Tap>
        </div>
        <CalorieSummary m={m} grow={grow} />
        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <div style={{ flex: 1.75 }}><Tap f={f} at={tapAdd}><Primary style={{ padding: "0 14px" }}><Icon name="plus" size={17} />Добавить запись</Primary></Tap></div>
          <div style={{ flex: 1 }}><Secondary>Цель КБЖУ</Secondary></div>
        </div>
      </Surface>
    </div>
    <div style={{ ...cas(f, at, 2), marginTop: 32 }}>
      <Surface>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div><Eyebrow>По времени</Eyebrow><H2>Записи</H2></div>
          <Glass radius={999} style={{ minWidth: 38, height: 30, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT_MONO, fontSize: 14 }}>{entries.length + (newEntry && insertP > 0.5 ? 1 : 0)}</Glass>
        </div>
        <InsertList rows={entries} newRow={newEntry} p={insertP} rowH={FOOD_ROW_H} render={(e) => <FoodRow e={e} />} />
      </Surface>
    </div>
    <div style={{ ...cas(f, at, 3), marginTop: 32, paddingBottom: 140 }}><NutritionReport f={f} metric={metric} tapMetricAt={tapMetricAt} selectDayAt={selectDayAt} /></div>
  </div>
);

/** Отчёт «Динамика КБЖУ»: переключатели 2×2, календарь месяца, выбранный день, график. */
const DAYS = [2410, 2150, 0, 2630, 1980, 2240, 2520, 2300, 1890, 2710, 2080, -1, 2360, 2290, 2540, 1840];
const NutritionReport: React.FC<{ f: number; metric: number; tapMetricAt?: number; selectDayAt?: number }> = ({ f, metric, tapMetricAt, selectDayAt }) => {
  const metrics = ["Калории", "Белки", "Жиры", "Углеводы"];
  const sel = selectDayAt !== undefined && f >= sec(selectDayAt) ? 10 : 16; // 16 → 10 ноября
  const selP = selectDayAt === undefined ? 0 : sp(f, selectDayAt, "snappy");
  const k = [1, 0.054, 0.032, 0.105][metric];
  const unit = metric === 0 ? "ккал" : "г";
  const shape = [[1, 1, 1, 1, 1, 1, 1], [0.8, 1.15, 1, 0.9, 1.2, 0.85, 1.05], [1.2, 0.8, 1, 1.1, 0.75, 1.2, 0.9], [0.9, 1.1, 1, 1.15, 0.9, 1, 0.8]][metric];
  const vals = DAYS.slice(-7).map((v, i) => Math.max(0, v) * k * shape[i]);
  const max = Math.max(...vals);
  const dayVal = DAYS[sel - 1];
  return (
    <Surface>
      <Eyebrow>Отчёт</Eyebrow><H2>Динамика КБЖУ</H2>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 16 }}>
        {metrics.map((l, i) => (
          <Tap key={l} f={f} at={i === metric ? tapMetricAt : undefined}>
            {i === metric ? <Primary>{l}</Primary> : <Secondary>{l}</Secondary>}
          </Tap>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 110, marginTop: 20 }}>
        {vals.map((v, i) => (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <div style={{ width: "100%", height: 86 * (v / max), borderRadius: 8, background: i === 6 ? C.accent : "rgba(116,43,69,.28)", transformOrigin: "bottom", transform: `scaleY(${tw(f, (tapMetricAt ?? -9) + 0.1, (tapMetricAt ?? -9) + 0.6) * 0 + 1})` }} />
            <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: C.text2 }}>{10 + i}</span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 22 }}>
        <span style={{ fontSize: 17, fontWeight: 520 }}>ноябрь 2026</span>
        <span style={{ color: C.text2, fontSize: 20 }}>‹ ›</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 5, marginTop: 10, fontSize: 12, color: C.text2, textAlign: "center" }}>
        {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((d) => <span key={d}>{d}</span>)}
        {Array.from({ length: 6 }, (_, i) => <span key={`e${i}`} />)}
        {Array.from({ length: 30 }, (_, i) => {
          const d = i + 1;
          const v = DAYS[i];
          const has = v !== undefined && v > 0;
          const zero = v === 0;
          const isSel = d === sel;
          return (
            <div key={d} style={{ height: 34, borderRadius: 10, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: FONT_MONO, fontSize: 13, color: isSel ? "#fff" : v === undefined ? "rgba(118,102,109,.45)" : C.text, background: isSel ? C.accent : has ? "rgba(255,255,255,.28)" : "transparent", border: zero ? `1px dashed ${C.divider}` : "1px solid transparent", transform: isSel ? `scale(${0.9 + 0.1 * (selectDayAt === undefined ? 1 : selP)})` : undefined }}>
              {d}
              {has && !isSel && <span style={{ width: 4, height: 4, borderRadius: 2, background: C.accent, opacity: 0.5, marginTop: 1 }} />}
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 14, fontSize: 14.5, display: "flex", flexDirection: "column", gap: 4, color: C.text2 }}>
        <span>{sel} ноября</span>
        <span className="tnum" style={{ fontFamily: FONT_MONO, fontSize: 13.5, color: C.text }}>{dayVal > 0 ? `${fmt(dayVal)} ккал · Б ${fmt(dayVal * 0.054)} · Ж ${fmt(dayVal * 0.032)} · У ${fmt(dayVal * 0.105)}` : "Записей нет"}</span>
      </div>
      <span style={{ display: "none" }}>{unit}</span>
    </Surface>
  );
};

// ---------- финансы ----------
const FinanceTabs: React.FC<{ f: number; active: number; tapAt?: number }> = ({ f, active, tapAt }) => (
  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 20 }}>
    {["Обзор", "Операции", "Планы", "Долги"].map((l, i) => (
      <Tap key={l} f={f} at={i === active ? tapAt : undefined}>
        {i === active ? <Primary style={{ padding: 0, fontSize: 14.5 }}>{l}</Primary> : <Secondary style={{ padding: 0, fontSize: 14.5 }}>{l}</Secondary>}
      </Tap>
    ))}
  </div>
);
const money = (n: number, signed = false, kind: "expense" | "income" = "expense") => `${signed ? (kind === "expense" ? "−" : "+") : ""}${fmt(n)} ${UNIT}`;

export const FinanceOverview: React.FC<{ f: number; at: number; balance: number; spent: number; month: number; tapAt?: number }> = ({ f, at, balance, spent, month, tapAt }) => (
  <div style={base}>
    <AppHeader />
    <div style={cas(f, at, 0)}><PageTitle>Финансы</PageTitle></div>
    <div style={cas(f, at, 1)}><FinanceTabs f={f} active={0} tapAt={tapAt} /></div>
    <div style={cas(f, at, 2)}>
      <Surface>
        <div style={{ display: "flex", justifyContent: "space-between" }}><Eyebrow>Обзор</Eyebrow><span style={{ fontSize: 13, color: C.text2 }}>понедельник, 16 ноября</span></div>
        <div style={{ marginTop: 18, fontSize: 15, color: C.text2 }}>Текущий баланс</div>
        <div className="tnum" style={{ fontSize: 60, letterSpacing: "-0.04em", lineHeight: 1.05, marginTop: 4 }}>{fmt(balance)}<small style={{ fontSize: 18, color: C.text2, marginLeft: 8, letterSpacing: 0 }}>{UNIT}</small></div>
        <div style={{ fontSize: 14, color: C.text2, marginTop: 6 }}>Зарплатная карта · Рубль</div>
        <div style={{ display: "flex", gap: 16, marginTop: 22 }}>
          <Stat label="Потрачено сегодня" value={fmt(spent)} unit={UNIT} />
          <Stat label="За месяц" value={fmt(month)} unit={UNIT} />
        </div>
        <div style={{ marginTop: 22 }}><Primary><Icon name="plus" size={17} />Добавить операцию</Primary></div>
      </Surface>
    </div>
    <div style={{ ...cas(f, at, 3), marginTop: 32 }}>
      <Surface>
        <Eyebrow>Ноябрь</Eyebrow><H2>По категориям</H2>
        {([["Продукты", 26050], ["Кафе и рестораны", 15900], ["Транспорт", 9700], ["Подписки", 6100], ["Прочее", 4500]] as const).map(([n, v], i) => (
          <div key={n} style={{ marginTop: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14.5 }}><span>{n}</span><span className="tnum" style={{ fontFamily: FONT_MONO, fontSize: 13.5 }}>{fmt(v)} {UNIT}</span></div>
            <div style={{ display: "flex", marginTop: 6 }}><Bar p={(v / 26050) * tw(f, at + 0.3 + i * 0.06, at + 0.9 + i * 0.06)} color={i === 0 ? C.accent : "rgba(116,43,69,.45)"} h={6} /></div>
          </div>
        ))}
      </Surface>
    </div>
  </div>
);

const MONEY_ROW_H = 84;
const MoneyRowView: React.FC<{ r: MoneyRow }> = ({ r }) => (
  <div style={{ display: "flex", gap: 12, alignItems: "flex-start", height: MONEY_ROW_H, paddingTop: 12, borderTop: `1px solid ${C.divider}` }}>
    <span className="tnum" style={{ fontFamily: FONT_MONO, fontSize: 13.5, color: C.text2, width: 44, paddingTop: 2 }}>{r.time}</span>
    <div style={{ flex: 1 }}><div style={{ fontSize: 16, fontWeight: 520 }}>{r.label}</div><div style={{ fontSize: 13, color: C.text2, marginTop: 3 }}>{r.category} · {r.kind === "income" ? "Доход" : "Расход"}</div></div>
    <span className="tnum" style={{ fontSize: 16, fontWeight: 520, color: r.kind === "income" ? C.income : C.text, paddingTop: 1 }}>{money(r.amount, true, r.kind)}</span>
  </div>
);
export const FinanceOperations: React.FC<{ f: number; at: number; balance: number; newRow?: boolean; insertP?: number; tapAt?: number }> = ({ f, at, balance, newRow, insertP = 1, tapAt }) => {
  const today = [MONEY.coffee, MONEY.taxi];
  return (
    <div style={base}>
      <AppHeader />
      <PageTitle>Финансы</PageTitle>
      <FinanceTabs f={f} active={1} tapAt={tapAt} />
      <div style={cas(f, at, 0)}>
        <Surface>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><div><Eyebrow>Счета</Eyebrow><H2>Мои счета</H2></div><TextLink icon="arrow">Управлять</TextLink></div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.divider}` }}>
            <div><div style={{ fontSize: 16, fontWeight: 520 }}>Зарплатная карта</div><div style={{ fontSize: 13, color: C.text2, marginTop: 3 }}>Рубль</div></div>
            <span className="tnum" style={{ fontSize: 16, fontWeight: 520 }}>{money(balance)}</span>
          </div>
        </Surface>
      </div>
      <div style={{ ...cas(f, at, 1), marginTop: 32 }}>
        <Surface>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}><div><Eyebrow>Движение денег</Eyebrow><H2>Операции</H2></div><TextLink lead="plus">Добавить</TextLink></div>
          <div style={{ fontSize: 13, color: C.text2, margin: "6px 0 8px" }}>понедельник, 16 ноября</div>
          <InsertList rows={today} newRow={newRow ? MONEY.udon : undefined} p={insertP} rowH={MONEY_ROW_H} render={(r) => <MoneyRowView r={r} />} />
          <div style={{ fontSize: 13, color: C.text2, margin: "14px 0 8px" }}>воскресенье, 15 ноября</div>
          <MoneyRowView r={MONEY.salary} />
        </Surface>
      </div>
    </div>
  );
};

/** Планы покупок. `insertP` (0..1) — новый план «firstName» встаёт сверху, итог растёт. */
export const FinancePlans: React.FC<{ f: number; at: number; tapAt?: number; insertP?: number; firstName?: string }> = ({ f, at, tapAt, insertP, firstName = "Кроссовки" }) => {
  const rows: [string, number, string][] = [[firstName, 9000, "декабрь"], ["Рюкзак", 4750, "декабрь"], ["Наушники", 3000, "январь"]];
  const p = insertP ?? 1;
  const total = 7750 + 9000 * p;
  return (
    <div style={base}>
      <AppHeader />
      <PageTitle>Финансы</PageTitle>
      <FinanceTabs f={f} active={2} tapAt={tapAt} />
      <div style={cas(f, at, 0)}>
        <Surface>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div><Eyebrow>Будущие покупки</Eyebrow><H2>Планы покупок</H2></div>
            <Glass radius={999} style={{ height: 44, display: "flex", alignItems: "center", gap: 6, padding: "0 14px", fontSize: 14.5, color: C.accent, fontWeight: 520 }}><Icon name="plus" size={15} />Добавить в план</Glass>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 18, fontSize: 15, color: C.text2 }}><span>Всего запланировано</span><strong className="tnum" style={{ color: C.text, fontWeight: 560 }}>{money(total)}</strong></div>
          {rows.map(([n, v, mo], i) => {
            const isNew = i === 0 && insertP !== undefined;
            const row = (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.divider}` }}>
                <div><div style={{ fontSize: 16, fontWeight: 520 }}>{n}</div><div style={{ fontSize: 13, color: C.text2, marginTop: 3 }}>{mo}</div></div>
                <span className="tnum" style={{ fontSize: 16, fontWeight: 520 }}>{money(v)}</span>
              </div>
            );
            return isNew
              ? <div key={n} style={{ height: 66 * p, overflow: "hidden", opacity: Math.max(0, (p - 0.5) / 0.5), transform: `translateY(${(1 - p) * -8}px)` }}>{row}</div>
              : <div key={n} style={cas(f, at, 1 + i)}>{row}</div>;
          })}
        </Surface>
      </div>
    </div>
  );
};

/** Карточка «Вес» из раздела «Питание»: текущий вес, график с линией среднего за 7 дней. */
export const WeightCard: React.FC<{ history: { date: string; kg: number }[]; newP: number }> = ({ history, newP }) => {
  const W = 300, Hh = 96, pad = 12;
  const pts = history.map((h, i) => (i === history.length - 1 ? { ...h, kg: lerp(history[i - 1].kg, h.kg, newP) } : h));
  const days = pts.map((_, i) => i);
  const trend = pts.map((_, i) => { const from = Math.max(0, i - 6); const sl = pts.slice(from, i + 1); return sl.reduce((a, b) => a + b.kg, 0) / sl.length; });
  const all = [...history.map((h) => h.kg), ...trend];
  const min = Math.min(...all), max = Math.max(...all), rg = max - min || 1;
  const x = (i: number) => pad + (i / (days.length - 1)) * (W - pad * 2);
  const y = (v: number) => Hh - pad - ((v - min) / rg) * (Hh - pad * 2);
  const n = pts.length - 1;
  const shown = (arr: number[]) => arr.map((v, i) => `${i === n ? lerp(x(n - 1), x(n), newP) : x(i)},${y(v)}`).join(" ");
  const cur = pts[n].kg;
  return (
    <Surface>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div><Eyebrow>Масса тела</Eyebrow><H2>Вес</H2></div>
        <TextLink lead="plus">Добавить</TextLink>
      </div>
      <div className="tnum" style={{ fontSize: 44, letterSpacing: "-0.035em", marginTop: 12 }}>{new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(cur)}<small style={{ fontSize: 15, color: C.text2, marginLeft: 8, letterSpacing: 0 }}>кг сейчас</small></div>
      <svg viewBox={`0 0 ${W} ${Hh}`} style={{ width: "100%", marginTop: 10, color: C.accent, overflow: "visible" }}>
        <polyline points={shown(pts.map((p) => p.kg))} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        <polyline points={shown(trend)} fill="none" stroke="#7f9a7b" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />
        {pts.map((p, i) => <circle key={i} cx={i === n ? lerp(x(n - 1), x(n), newP) : x(i)} cy={y(p.kg)} r={i === n ? 3.5 + 2.5 * Math.sin(Math.min(1, newP) * Math.PI) : 3.5} fill="currentColor" opacity={i === n ? newP : 1} />)}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: FONT_MONO, fontSize: 11.5, color: C.text2, marginTop: 6 }}><span>{history[0].date}</span><span>{history[n].date}</span></div>
      <div style={{ fontSize: 13, color: C.text2, marginTop: 8 }}>Линия — среднее за 7 дней</div>
    </Surface>
  );
};

export type DebtGroups = readonly (readonly [string, string, readonly (readonly [string, number, string])[]])[];

const DEBT_GROUPS: DebtGroups = [["Я должен", "Мои долги другим людям", [["Иван", 2500, ""]]], ["Мне должны", "", [["Анна", 1500, "Вернула 1\u00a0000 из 2\u00a0500"]]]];

export const FinanceDebts: React.FC<{ f: number; at: number; tapAt?: number; groups?: DebtGroups }> = ({ f, at, tapAt, groups = DEBT_GROUPS }) => (
  <div style={base}>
    <AppHeader />
    <PageTitle>Финансы</PageTitle>
    <FinanceTabs f={f} active={3} tapAt={tapAt} />
    <div style={cas(f, at, 0)}>
      <Surface>
        <H2>Долги</H2>
        {groups.map(([t, d, rows], gi) => (
          <div key={t} style={{ ...cas(f, at, 1 + gi), marginTop: 18 }}>
            <div style={{ fontSize: 16, fontWeight: 560 }}>{t}</div>
            {d && <div style={{ fontSize: 13, color: C.text2, marginTop: 2 }}>{d}</div>}
            {rows.map(([n, v, note]) => (
              <div key={n} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, paddingTop: 12, borderTop: `1px solid ${C.divider}` }}>
                <div><div style={{ fontSize: 16, fontWeight: 520 }}>{n}</div>{note && <div style={{ fontSize: 13, color: C.text2, marginTop: 3 }}>{note}</div>}</div>
                <span className="tnum" style={{ fontSize: 16, fontWeight: 520 }}>{money(v)}</span>
              </div>
            ))}
          </div>
        ))}
      </Surface>
    </div>
  </div>
);

// ---------- зал ----------
const EXERCISES = [
  { name: "Жим лёжа", sets: 3, prev: "60 кг × 8", hint: true },
  { name: "Тяга верхнего блока", sets: 3, prev: "55 кг × 10", hint: false },
  { name: "Жим гантелей сидя", sets: 3, prev: "18 кг × 10", hint: false },
  { name: "Тяга гантели в наклоне", sets: 3, prev: "24 кг × 10", hint: true },
  { name: "Отжимания на брусьях", sets: 3, prev: "12 повт.", hint: false },
];
export const GymWorkout: React.FC<{ f: number; at: number; tapAt?: number }> = ({ f, at, tapAt }) => (
  <div style={base}>
    <AppHeader />
    <PageTitle>Зал</PageTitle>
    <div style={cas(f, at, 0)}>
      <Surface>
        <TextLink lead="back">К плану</TextLink>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}><div><Eyebrow>Тренировка</Eyebrow><H2 size={24}>Верх тела A</H2></div><TextLink icon="arrow">Продолжить</TextLink></div>
        <div style={{ marginTop: 10 }}>
          {EXERCISES.map((e, i) => (
            <div key={e.name} style={{ ...cas(f, at, 1 + i), marginTop: 6 }}>
              <Tap f={f} at={i === 0 ? tapAt : undefined} radius={18}>
                <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px 0", borderTop: `1px solid ${C.divider}` }}>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 14, color: C.text2 }}>{String(i + 1).padStart(2, "0")}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 16.5, fontWeight: 520 }}>{e.name}</div>
                    <div style={{ fontSize: 13, color: C.text2, marginTop: 3 }}>{e.sets} подхода · Было {e.prev}{e.hint && <span style={{ color: C.accent }}> · Можно увеличить вес</span>}</div>
                  </div>
                  <Icon name="arrow" size={14} style={{ color: C.text2 }} />
                </div>
              </Tap>
            </div>
          ))}
        </div>
      </Surface>
    </div>
  </div>
);

export const GymExercise: React.FC<{ f: number; at: number; doneAt: number; timerStart: number; hintAt: number }> = ({ f, at, doneAt, timerStart, hintAt }) => {
  const done = f >= sec(doneAt);
  const left = Math.max(0, 90 - Math.max(0, (f - sec(timerStart)) / 30));
  const running = f >= sec(timerStart);
  const timer = `${String(Math.floor(left / 60)).padStart(2, "0")}:${String(Math.floor(left % 60)).padStart(2, "0")}`;
  const hint = appear(f, hintAt, 8, 0.35);
  const sets = [["1", "60 кг · 8 повт."], ["2", "60 кг · 8 повт."], ["3", "60 кг · 8 повт."]];
  return (
    <div style={base}>
      <AppHeader />
      <PageTitle>Зал</PageTitle>
      <div style={cas(f, at, 0)}>
        <Surface>
          <TextLink lead="back">К тренировке</TextLink>
          <div style={{ marginTop: 14 }}><Eyebrow>Верх тела A</Eyebrow><H2 size={26}>Жим лёжа</H2></div>
          <div style={{ fontSize: 14, color: C.text2, marginTop: 6 }}>В прошлый раз: 60 кг × 8</div>
          <div style={{ ...hint, marginTop: 8 }}>
            <Glass radius={16} style={{ padding: "10px 14px", fontSize: 14.5, color: C.accent, fontWeight: 540 }}>Можно увеличить вес</Glass>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "52px 1fr 118px", fontSize: 13, color: C.text2, marginTop: 18 }}><span>Подход</span><span>Результат</span><span>Статус</span></div>
          {sets.map(([n, r], i) => {
            const isDone = i === 0 && done;
            const pr = i === 0 ? press(f, doneAt - 0.05) : { scale: 1, ring: -1 };
            return (
              <div key={n} style={{ display: "grid", gridTemplateColumns: "52px 1fr 118px", alignItems: "center", padding: "10px 0", borderTop: `1px solid ${C.divider}` }}>
                <strong className="tnum" style={{ fontSize: 17, fontWeight: 560 }}>{n}</strong>
                <span className="tnum" style={{ fontSize: 15.5 }}>{r}</span>
                <div style={{ transform: `scale(${pr.scale})` }}>
                  {isDone
                    ? <div style={{ height: 40, borderRadius: 999, background: C.accent, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", gap: 5, fontSize: 14.5, fontWeight: 540 }}><Icon name="check" size={16} />Готово</div>
                    : <Glass radius={999} style={{ height: 40, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, fontSize: 14.5 }}><Icon name="check" size={16} />Отметить</Glass>}
                </div>
              </div>
            );
          })}
          <Glass radius={22} style={{ marginTop: 16, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div><div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 15.5, fontWeight: 540 }}><Icon name="clock" size={17} />Таймер отдыха</div><div style={{ fontSize: 13, color: C.text2, marginTop: 4 }}>Между подходами · 01:30</div></div>
              <span className="tnum" style={{ fontFamily: FONT_MONO, fontSize: 34, color: running ? C.accent : C.text }}>{timer}</span>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              {running ? <Secondary style={{ flex: 1, height: 44, opacity: 0.55 }}>Старт</Secondary> : <Primary style={{ flex: 1, height: 44 }}>Старт</Primary>}
              <Secondary style={{ flex: 1, height: 44, opacity: running ? 1 : 0.55 }}>Стоп</Secondary>
              <Secondary style={{ flex: 1, height: 44 }}>Сбросить</Secondary>
            </div>
          </Glass>
        </Surface>
      </div>
    </div>
  );
};

// ---------- настройки ----------
export const SettingsMenu: React.FC<{ f: number; at: number; tapAt?: number }> = ({ f, at, tapAt }) => (
  <div style={base}>
    <AppHeader />
    <div style={{ height: 24 }} />
    {([["Персонализация", "Разделы и функции, сводки и напоминания."], ["ИИ-провайдеры", "Ключи и модели, которыми бот разбирает сообщения."], ["Данные и приватность", "Политика, согласия, копия данных, удаление и исходный код."]] as const).map(([t, d], i) => (
      <div key={t} style={{ ...cas(f, at, i), marginBottom: 14 }}>
        <Tap f={f} at={i === 0 ? tapAt : undefined} radius={27}>
          <Glass radius={27} style={{ padding: "18px 20px", display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ flex: 1 }}><div style={{ fontSize: 17, fontWeight: 540 }}>{t}</div><div style={{ fontSize: 13.5, color: C.text2, marginTop: 4, lineHeight: 1.35 }}>{d}</div></div>
            <Icon name="arrow" size={15} style={{ color: C.accent }} />
          </Glass>
        </Tap>
      </div>
    ))}
  </div>
);

const Toggle: React.FC<{ on: number }> = ({ on }) => (
  <div style={{ width: 50, height: 30, borderRadius: 999, background: `rgba(116,43,69,${0.12 + 0.88 * on})`, position: "relative", flexShrink: 0, boxShadow: "inset 0 1px 2px rgba(53,39,44,.12)" }}>
    <div style={{ position: "absolute", top: 3, left: 3 + 20 * on, width: 24, height: 24, borderRadius: 12, background: "#fff", boxShadow: "0 2px 5px rgba(53,39,44,.2)" }} />
  </div>
);
/** «Персонализация»: тексты из personalization-page.tsx и domain/modules.ts. */
export const Personalization: React.FC<{ f: number; at: number; toggles: Record<string, number> }> = ({ f, at, toggles }) => {
  const rows: [string, string, string, boolean][] = [
    ["nutrition", "Питание", "КБЖУ еды, вес и норма калорий под твою цель. Еду можно записывать сообщением боту или вручную.", false],
    ["nutrition.weight", "Вес", "Замеры массы тела, график с трендом, напоминание взвеситься и пересчёт нормы по среднему весу.", true],
    ["finance", "Финансы", "Счета в любых валютах, расходы и доходы, подписки, долги и планы покупок.", false],
    ["finance.debts", "Долги", "Кому ты должен и кто должен тебе, частичные возвраты и напоминания о сроке.", true],
    ["finance.plans", "Планы покупок", "Что хочешь купить. План не расход, пока ты не отметишь покупку.", true],
    ["gym", "Зал", "Программа тренировок, упражнения, подходы и таймер отдыха. Ведётся в Mini App.", false],
  ];
  return (
    <div style={base}>
      <AppHeader />
      <div style={cas(f, at, 0)}><PageTitle>Персонализация</PageTitle></div>
      <div style={{ ...cas(f, at, 1), fontSize: 14, color: C.text2, lineHeight: 1.4, marginTop: -6, marginBottom: 18 }}>Выключенные разделы и функции пропадают из приложения, не попадают в сводки и напоминания и не передаются ИИ. Данные сохраняются: включи снова, и всё будет на месте.</div>
      <div style={cas(f, at, 2)}>
        <Surface>
          <H2>Разделы и функции</H2>
          {rows.map(([k, l, d, nested]) => (
            <div key={k} style={{ display: "flex", gap: 14, alignItems: "flex-start", marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.divider}`, paddingLeft: nested ? 18 : 0 }}>
              <div style={{ flex: 1 }}><div style={{ fontSize: 16, fontWeight: 540 }}>{l}</div><div style={{ fontSize: 13, color: C.text2, marginTop: 3, lineHeight: 1.35 }}>{d}</div></div>
              <Toggle on={toggles[k] ?? 1} />
            </div>
          ))}
        </Surface>
      </div>
    </div>
  );
};

/** Нижняя панель «Быстрое действие» (ActionSheet из lifeos-app.tsx), раздел «Питание». */
export const ActionSheet: React.FC<{ p: number }> = ({ p }) => (
  <>
    <div style={{ position: "absolute", inset: 0, background: `rgba(53,39,44,${0.16 * p})` }} />
    <div style={{ position: "absolute", left: 8, right: 8, bottom: 8, transform: `translateY(${(1 - p) * 110}%)` }}>
      <Glass radius={30} strong style={{ padding: "12px 20px 22px", background: "rgba(250,246,243,.78)", ...base }}>
        <div style={{ width: 40, height: 5, borderRadius: 3, background: "rgba(96,45,62,.22)", margin: "0 auto 14px" }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div><Eyebrow>Быстрое действие</Eyebrow><H2 size={24}>Питание</H2></div>
          <Glass radius={999} style={{ width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="close" size={18} /></Glass>
        </div>
        <div style={{ fontSize: 14.5, color: C.text2, marginTop: 10, lineHeight: 1.4 }}>Записи можно добавлять сообщением или фотографией в чате с ботом.</div>
        {([["Записать еду", "Текст или фото · КБЖУ"], ["Внести массу тела", "Запись попадёт в историю веса"], ["Настроить цель КБЖУ", "Цель на набор массы"]] as const).map(([l, d]) => (
          <Glass key={l} radius={22} style={{ marginTop: 10, padding: "14px 18px", display: "flex", alignItems: "center" }}>
            <div style={{ flex: 1 }}><div style={{ fontSize: 16, fontWeight: 540 }}>{l}</div><div style={{ fontSize: 13, color: C.text2, marginTop: 3 }}>{d}</div></div>
            <Icon name="arrow" size={15} style={{ color: C.accent }} />
          </Glass>
        ))}
      </Glass>
    </div>
  </>
);

// ---------- док ----------
export type Tab = "today" | "nutrition" | "finance" | "gym" | "settings";
const TABS: Tab[] = ["today", "nutrition", "finance", "gym", "settings"];
/** Плавающая стеклянная капсула, только иконки; общий активный индикатор переезжает пружиной. */
export const Dock: React.FC<{ f: number; moves: { t: number; tab: Tab }[]; gymOn?: number }> = ({ f, moves, gymOn = 1 }) => {
  const w = TABS.map((t) => (t === "gym" ? gymOn : 1));
  const total = w.reduce((a, b) => a + b, 0);
  const inner = 350 - 16;
  const centers: number[] = [];
  let acc = 0;
  for (const wi of w) { centers.push(8 + ((acc + wi / 2) / total) * inner); acc += wi; }
  let lens = centers[TABS.indexOf(moves[0].tab)];
  for (let i = 1; i < moves.length; i++) lens = lerp(lens, centers[TABS.indexOf(moves[i].tab)], sp(f, moves[i].t, "smooth"));
  const active = [...moves].reverse().find((m) => f >= sec(m.t))?.tab ?? moves[0].tab;
  const lensW = inner / total - 6;
  return (
    <Glass radius={999} style={{ width: 350, height: 66, background: "rgba(255,255,255,.06)" }}>
      <div style={{ position: "absolute", top: 7, left: lens - lensW / 2, width: lensW, height: 52, borderRadius: 999, background: "rgba(255,255,255,.55)", boxShadow: "inset 0 1px 0 rgba(255,255,255,.95), 0 6px 16px rgba(116,43,69,.14)" }} />
      {TABS.map((t, i) => (
        <div key={t} style={{ position: "absolute", top: 0, left: centers[i] - 22, width: 44, height: 66, display: "flex", alignItems: "center", justifyContent: "center", color: t === active ? C.accent : C.text, opacity: t === "gym" ? gymOn : 1, transform: t === "gym" ? `scale(${0.6 + 0.4 * gymOn})` : undefined }}>
          <Icon name={t} size={23} />
        </div>
      ))}
    </Glass>
  );
};

// ---------- окно приложения ----------
export type Segment = { t: number; render: (f: number) => React.ReactNode; cam: CamKey[] };
/**
 * Окно в приложение без рамки устройства: клип со скруглением, контент под виртуальной камерой,
 * док и нижние панели поверх (вне камеры). Смена экранов — короткое смещение и прозрачность.
 */
export const AppWindow: React.FC<{ f: number; w: number; h: number; segments: Segment[]; dock?: { t: number; tab: Tab }[]; gymOn?: number; overlay?: React.ReactNode; style?: React.CSSProperties }> = ({ f, w, h, segments, dock, gymOn, overlay, style }) => {
  const S = w / APP_W;
  let ci = 0;
  segments.forEach((s, i) => { if (f >= sec(s.t)) ci = i; });
  const layers: { s: Segment; o: number; dy: number }[] = [];
  const cur = segments[ci];
  // Новый экран входит сразу, старый уходит с перекрытием: без провала в пустоту.
  const pin = tw(f, cur.t, cur.t + 0.22);
  if (ci > 0 && f < sec(cur.t + 0.24)) layers.push({ s: segments[ci - 1], o: 1 - tw(f, cur.t + 0.06, cur.t + 0.22), dy: 0 });
  layers.push({ s: cur, o: ci === 0 ? 1 : pin, dy: ci === 0 ? 0 : (1 - pin) * 6 });
  return (
    <div style={{ position: "absolute", width: w, height: h, borderRadius: 44, overflow: "hidden", WebkitMaskImage: "linear-gradient(to bottom, transparent 0, #000 56px, #000 calc(100% - 40px), transparent 100%)", maskImage: "linear-gradient(to bottom, transparent 0, #000 56px, #000 calc(100% - 40px), transparent 100%)", ...style }}>
      {layers.map(({ s, o, dy }, i) => {
        const c = camera(f, s.cam);
        const k = S * c.z;
        const cx = c.x + (APP_W - APP_W / c.z) / 2; // зум остаётся по центру окна
        return (
          <div key={i} style={{ position: "absolute", left: 0, top: 0, width: APP_W, padding: "10px 20px 0", transformOrigin: "0 0", transform: `scale(${k}) translate(${-cx}px, ${-c.y + dy}px)`, opacity: o }}>
            {s.render(f)}
          </div>
        );
      })}
      {dock && (
        <div style={{ position: "absolute", left: (w - 350 * S) / 2, bottom: 14 * S, width: 350, transformOrigin: "0 100%", transform: `scale(${S})` }}>
          <Dock f={f} moves={dock} gymOn={gymOn} />
        </div>
      )}
      {overlay && <div style={{ position: "absolute", left: 0, top: 0, width: APP_W, height: h / S, transformOrigin: "0 0", transform: `scale(${S})` }}>{overlay}</div>}
    </div>
  );
};

export { FIN };
