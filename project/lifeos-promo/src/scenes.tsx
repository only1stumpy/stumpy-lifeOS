import React from "react";
import { useCurrentFrame } from "remotion";
import { C, FONT_SANS } from "./tokens";
import { appear, sec, sp, springNum, tw, typingDuration } from "./anim";
import { config, FIN, FOOD, MONEY, type FoodEntry } from "./config";
import { Caption, Glass } from "./ui";
import { CHAT_W, CHAT_X, Draft, OutBubble, Receipt, StatusBubble } from "./chat";
import {
  ActionSheet, AppWindow, FinanceDebts, FinanceOperations, FinanceOverview, FinancePlans, GymExercise, GymWorkout, Icon,
  NutritionScreen, Personalization, SettingsMenu, TodayScreen, type Macros,
} from "./app";

const cap = config.captions;
const sum = (list: FoodEntry[]): Macros => list.reduce((a, e) => ({ kcal: a.kcal + e.kcal, p: a.p + e.p, f: a.f + e.f, c: a.c + e.c }), { kcal: 0, p: 0, f: 0, c: 0 });
const mix = (a: Macros, b: Macros, p: number): Macros => ({ kcal: a.kcal + (b.kcal - a.kcal) * p, p: a.p + (b.p - a.p) * p, f: a.f + (b.f - a.f) * p, c: a.c + (b.c - a.c) * p });
const BASE_ENTRIES = [FOOD.curd, FOOD.yogurt, FOOD.omelet];
const M0 = sum(BASE_ENTRIES);
const M1 = sum([...BASE_ENTRIES, FOOD.buckwheat]);
const M2 = sum([...BASE_ENTRIES, FOOD.buckwheat, FOOD.udon]);

// Тексты черновиков: формат formatDraft() из src/server/telegram/handlers/drafts.ts,
// подтверждения — formatConfirmedRecords() из src/server/telegram/confirmation.ts.
const kbju = (e: FoodEntry) => `КБЖУ: ${e.kcal} ккал · Б ${e.p} · Ж ${e.f} · У ${e.c} г`;
const head = (time: string) => `Проверь, пожалуйста · 16 нояб. 2026 г., ${time}`;
const foodDraft = (e: FoodEntry, time = e.time) => [head(time), `Еда: ${e.label} · ${e.portion}`, kbju(e), ...(e.est ? ["КБЖУ оценены примерно."] : [])];
const foodConfirm = (e: FoodEntry) => [`Записал еду: ${e.label} · ${e.portion}`, kbju(e)];

/** Связка чат → приложение: чат уходит вниз и уменьшается, сверху выезжает окно Mini App. */
const linkLayout = (f: number, at: number, chatTop: number, chatH: number, scale: number) => {
  const p = sp(f, at, "smooth");
  const targetTop = 1570 - chatH * scale;
  return { transform: `translateY(${(targetTop - chatTop) * p}px) scale(${1 - (1 - scale) * p})`, transformOrigin: "50% 0" };
};
const windowIn = (f: number, at: number) => {
  const p = sp(f, at, "gentle");
  return { opacity: Math.min(1, p * 1.6), transform: `translateY(${(1 - p) * -60}px) scale(${0.96 + 0.04 * p})` };
};

// ---------------- A1: хук + еда ----------------
export const SceneFood: React.FC = () => {
  const f = useCurrentFrame();
  const text = "съел гречку с курицей";
  const typeStart = 0.45;
  const sendAt = typeStart + typingDuration(text) + 0.12;
  const draftAt = sendAt + 0.4;
  const tapAt = 4.9;
  const confirmAt = 5.12;
  const linkAt = 6.6;
  const insertAt = 7.35;
  const titleOut = 1 - tw(f, 2.85, 3.2);
  const h1 = appear(f, 0, 18, 0.45);
  const h2 = appear(f, 0.12, 18, 0.45);
  return (
    <>
      <div style={{ position: "absolute", left: 0, right: 0, top: 240, display: "flex", justifyContent: "center", transform: appear(f, 0, 10, 0.35).transform, opacity: titleOut * appear(f, 0, 10, 0.35).opacity }}>
        <Glass radius={999} strong style={{ padding: "16px 38px", fontFamily: FONT_SANS, fontSize: 42, fontWeight: 540, color: C.accent }}>{config.hook.badge}</Glass>
      </div>
      <div style={{ position: "absolute", left: 70, right: 70, top: 350, textAlign: "center", fontFamily: FONT_SANS, color: C.text, opacity: titleOut, letterSpacing: "-0.03em", lineHeight: 1.04 }}>
        <div style={{ ...h1, fontSize: 108, fontWeight: 560 }}>{config.hook.line1}</div>
        <div style={{ ...h2, fontSize: 82, fontWeight: 460, color: C.accent, marginTop: 16 }}>{config.hook.line2}</div>
      </div>
      <Caption text={cap.confirm} at={3.25} until={6.5} />
      <Caption text={cap.linkFood} at={6.9} />
      <div style={{ position: "absolute", left: CHAT_X, top: 700, width: CHAT_W, height: 560, display: "flex", flexDirection: "column", gap: 22, ...linkLayout(f, linkAt, 700, 560, 0.7) }}>
        <OutBubble frame={f} text={text} typeStart={typeStart} sendAt={sendAt} />
        <Draft frame={f} at={draftAt} lines={foodDraft(FOOD.buckwheat)} confirmLines={foodConfirm(FOOD.buckwheat)} tapAt={tapAt} confirmAt={confirmAt} />
      </div>
      {f >= sec(linkAt) && (
        <AppWindow
          f={f} w={960} h={740}
          style={{ left: 60, top: 400, ...windowIn(f, linkAt + 0.1) }}
          segments={[{
            t: 0,
            render: (ff) => <NutritionScreen f={ff} at={-5} m={mix(M0, M1, sp(ff, insertAt))} grow={1} entries={BASE_ENTRIES} newEntry={FOOD.buckwheat} insertP={sp(ff, insertAt, "smooth")} />,
            cam: [{ t: 0, x: 0, y: 214, z: 1.08 }, { t: 8.3, x: 0, y: 590, z: 1.08, dur: 1.1 }],
          }]}
        />
      )}
    </>
  );
};

// ---------------- A2: одно сообщение — две записи ----------------
export const SceneSplit: React.FC = () => {
  const f = useCurrentFrame();
  const text = "съел удон за 425";
  const typeStart = 0.25;
  const sendAt = typeStart + typingDuration(text) + 0.1;
  const tapFood = 3.15, tapMoney = 3.75, linkAt = 4.3;
  const balanceAt = 4.85, opsAt = 5.45;
  return (
    <>
      <Caption text={cap.split} at={1.6} until={4.2} />
      <Caption text={cap.linkMoney} at={4.5} />
      <div style={{ position: "absolute", left: CHAT_X, top: 400, width: CHAT_W, height: 1080, display: "flex", flexDirection: "column", gap: 22, ...linkLayout(f, linkAt, 400, 600, 0.62) }}>
        <OutBubble frame={f} text={text} typeStart={typeStart} sendAt={sendAt} />
        <Draft frame={f} at={sendAt + 0.4} lines={foodDraft(FOOD.udon)} confirmLines={foodConfirm(FOOD.udon)} tapAt={tapFood} confirmAt={tapFood + 0.22} />
        <Draft frame={f} at={sendAt + 0.7} lines={[head("13:50"), "Расход: Удон · 425,00 руб.", "Категория: Кафе и рестораны"]} confirmLines={["Записал расход: Удон · 425,00 руб."]} tapAt={tapMoney} confirmAt={tapMoney + 0.22} />
      </div>
      {f >= sec(linkAt) && (
        <AppWindow
          f={f} w={960} h={780}
          style={{ left: 60, top: 400, ...windowIn(f, linkAt + 0.1) }}
          segments={[
            { t: 0, render: (ff) => <FinanceOverview f={ff} at={-5} balance={springNum(ff, balanceAt, FIN.balanceBefore, FIN.balanceAfter)} spent={springNum(ff, balanceAt, FIN.todayBefore, FIN.todayAfter)} month={springNum(ff, balanceAt, FIN.month - MONEY.udon.amount, FIN.month)} />, cam: [{ t: 0, x: 0, y: 225, z: 1.05 }] },
            { t: opsAt, render: (ff) => <FinanceOperations f={ff} at={opsAt} balance={FIN.balanceAfter} newRow insertP={sp(ff, opsAt + 0.3, "smooth")} tapAt={opsAt} />, cam: [{ t: 0, x: 0, y: 380, z: 1.05 }] },
          ]}
        />
      )}
    </>
  );
};

// ---------------- A3: несколько приёмов за раз ----------------
export const SceneMulti: React.FC = () => {
  const f = useCurrentFrame();
  const text = "утром два бутера, в обед солянка, сейчас удон";
  const typeStart = 0.2;
  const sendAt = typeStart + typingDuration(text, 26) + 0.08;
  const butter: FoodEntry = { time: "09:00", label: "Бутерброды", portion: "2 шт.", kcal: 520, p: 22, f: 24, c: 54 };
  const solyanka: FoodEntry = { time: "13:00", label: "Солянка", portion: "1 порция", kcal: 310, p: 18, f: 20, c: 12 };
  const udon: FoodEntry = { ...FOOD.udon, est: false };
  return (
    <>
      <Caption text={cap.multi} at={0.15} />
      <div style={{ position: "absolute", left: CHAT_X, top: 390, width: CHAT_W, display: "flex", flexDirection: "column", gap: 20, transform: "scale(0.86)", transformOrigin: "50% 0" }}>
        <OutBubble frame={f} text={text} typeStart={typeStart} sendAt={sendAt} cps={26} />
        {[butter, solyanka, udon].map((e, i) => <Draft key={e.label} frame={f} at={sendAt + 0.35 + i * 0.22} lines={foodDraft(e)} kbDelay={0.12} />)}
      </div>
    </>
  );
};

// ---------------- A4: фото чека ----------------
const RECEIPT: [string, number][] = [["Молоко", 160], ["Хлеб", 72.5], ["Яйца", 205], ["Сыр", 287.5], ["Кофе", 315], ["Бананы", 190]];
const plainNum = (n: number) => new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const plain = (n: number) => `${plainNum(n)} руб.`; // формат formatMoneyPlain, валюта показана как рубли
export const SceneReceipt: React.FC = () => {
  const f = useCurrentFrame();
  const photo = appear(f, 0.15, 16, 0.32);
  const listAt = 2.05;
  const total = RECEIPT.reduce((a, [, v]) => a + v, 0);
  // formatDraftList() + bulkDraftKeyboard(): больше пяти позиций — одно сообщение со списком.
  const lines = [
    `Проверь, пожалуйста · позиций: ${RECEIPT.length}`,
    ...RECEIPT.map(([n, v], i) => `${i + 1}. ${n} · ${plain(v)} · Продукты`),
    `Итого: ${plain(total)}`,
    "Каждая позиция запишется отдельной операцией. Отдельную позицию потом можно поправить или удалить в Mini App → Финансы.",
  ];
  return (
    <>
      <Caption text={cap.receipt} at={1.5} />
      <div style={{ position: "absolute", left: CHAT_X, top: 400, width: CHAT_W, display: "flex", flexDirection: "column", gap: 22 }}>
        <div style={{ display: "flex", justifyContent: "flex-end", ...photo }}>
          <div style={{ background: C.accent, padding: 14, borderRadius: "40px 40px 12px 40px", boxShadow: "0 14px 34px rgba(116,43,69,.28)" }}>
            <div style={{ borderRadius: 28, overflow: "hidden", background: "linear-gradient(160deg,#d9cfc6,#c9bcb4)", padding: "26px 30px" }}>
              <Receipt rows={RECEIPT.map(([n, v]) => [n, plainNum(v)])} total={plainNum(total)} />
            </div>
          </div>
        </div>
        {f < sec(listAt) ? (
          // Реальные статусы из messages.ts: сообщение «Смотрю фото…» редактируется по ходу разбора.
          <StatusBubble frame={f} items={[{ at: 0.6, text: "Смотрю фото…" }, { at: 1.15, text: "Сверяю детали перед записью…" }, { at: 1.6, text: "Готовлю отдельные черновики для подтверждения…" }]} />
        ) : (
          <Draft frame={f} at={listAt} lines={lines} rows={[[{ label: "Записать все", primary: true }, { label: "Отменить все" }]]} tapAt={3.15} tapLabel="Записать все" />
        )}
      </div>
    </>
  );
};

// ---------------- B: приложение крупно ----------------
export const SceneApp: React.FC = () => {
  const f = useCurrentFrame();
  const T = { nut: 5.0, fin: 10.4, ops: 12.5, plans: 13.8, debts: 14.9, gym: 16.0, ex: 17.0, set: 19.8, pers: 20.45 };
  const yesterday: Macros = { kcal: 2240, p: 128, f: 71, c: 236 };
  const dayP = Math.min(sp(f, 5.9, "snappy"), 1 - sp(f, 6.6, "snappy"));
  const sheetP = f < sec(8.45) ? sp(f, 7.5, "smooth") : 1 - sp(f, 8.45, "smooth");
  const gymOn = 1 - sp(f, T.pers + 0.75, "snappy");
  const debtsOn = 1 - sp(f, T.pers + 1.05, "snappy");
  const enter = sp(f, 0, "gentle");
  const allFood = [FOOD.udon, FOOD.buckwheat, ...BASE_ENTRIES];
  return (
    <>
      <Caption text={cap.today} at={0.25} until={4.95} />
      <Caption text={cap.nutrition} at={T.nut + 0.1} until={T.fin - 0.05} />
      <Caption text={cap.finance} at={T.fin + 0.1} until={T.gym - 0.05} />
      <Caption text={cap.gym} at={T.gym + 0.1} until={T.set - 0.05} />
      <Caption text={cap.settings} at={T.set + 0.1} />
      <AppWindow
        f={f} w={960} h={1150}
        style={{ left: 60, top: 410, opacity: Math.min(1, enter * 1.5), transform: `translateY(${(1 - enter) * 90}px)` }}
        dock={[{ t: 0, tab: "today" }, { t: T.nut, tab: "nutrition" }, { t: T.fin, tab: "finance" }, { t: T.gym, tab: "gym" }, { t: T.set, tab: "settings" }]}
        gymOn={gymOn}
        overlay={sheetP > 0.001 ? <ActionSheet p={sheetP} /> : undefined}
        segments={[
          {
            t: 0,
            render: (ff) => <TodayScreen f={ff} at={0.1} m={mix({ kcal: 0, p: 0, f: 0, c: 0 }, M2, sp(ff, 0.45))} grow={1} balance={FIN.balanceAfter} spent={FIN.todayAfter} />,
            cam: [{ t: 0, x: 0, y: 0, z: 1 }, { t: 1.5, x: 0, y: 128, z: 1.14 }, { t: 2.8, x: 0, y: 470, z: 1.14 }, { t: 3.9, x: 0, y: 540, z: 1.0 }],
          },
          {
            t: T.nut,
            render: (ff) => (
              <NutritionScreen
                f={ff} at={T.nut - 0.14} m={mix(M2, yesterday, dayP)} grow={1} entries={allFood}
                date={ff >= sec(5.9) && ff < sec(6.6) ? "воскресенье, 15 ноября" : "понедельник, 16 ноября"}
                tapPrev={5.85} tapNext={6.55} tapAdd={7.35}
                metric={ff >= sec(9.45) ? 1 : 0} tapMetricAt={9.45} selectDayAt={9.95}
              />
            ),
            cam: [{ t: T.nut, x: 0, y: 112, z: 1.0 }, { t: 8.6, x: 0, y: 960, z: 1.0, dur: 0.7 }, { t: 9.5, x: 0, y: 1370, z: 1.0, dur: 0.5 }],
          },
          {
            t: T.fin,
            render: (ff) => <FinanceOverview f={ff} at={T.fin - 0.14} balance={FIN.balanceAfter} spent={FIN.todayAfter} month={FIN.month} />,
            cam: [{ t: T.fin, x: 0, y: 128, z: 1.0 }, { t: 11.5, x: 0, y: 520, z: 1.0, dur: 0.8 }],
          },
          { t: T.ops, render: (ff) => <FinanceOperations f={ff} at={T.ops - 0.14} balance={FIN.balanceAfter} newRow tapAt={T.ops} />, cam: [{ t: T.ops, x: 0, y: 128, z: 1.0 }] },
          { t: T.plans, render: (ff) => <FinancePlans f={ff} at={T.plans - 0.14} tapAt={T.plans} />, cam: [{ t: T.plans, x: 0, y: 128, z: 1.06 }] },
          { t: T.debts, render: (ff) => <FinanceDebts f={ff} at={T.debts - 0.14} tapAt={T.debts} />, cam: [{ t: T.debts, x: 0, y: 128, z: 1.06 }] },
          { t: T.gym, render: (ff) => <GymWorkout f={ff} at={T.gym - 0.14} tapAt={16.75} />, cam: [{ t: T.gym, x: 0, y: 128, z: 1.0 }] },
          {
            t: T.ex,
            render: (ff) => <GymExercise f={ff} at={T.ex - 0.14} doneAt={17.9} timerStart={18.05} hintAt={17.35} />,
            cam: [{ t: T.ex, x: 0, y: 128, z: 1.06 }, { t: 18.15, x: 0, y: 250, z: 1.06, dur: 0.7 }],
          },
          { t: T.set, render: (ff) => <SettingsMenu f={ff} at={T.set - 0.14} tapAt={20.25} />, cam: [{ t: T.set, x: 0, y: 70, z: 1.06 }] },
          {
            t: T.pers,
            render: (ff) => <Personalization f={ff} at={T.pers - 0.14} toggles={{ gym: gymOn, "finance.debts": debtsOn }} />,
            cam: [{ t: T.pers, x: 0, y: 70, z: 1.0 }, { t: T.pers + 0.3, x: 0, y: 470, z: 1.0, dur: 0.6 }],
          },
        ]}
      />
    </>
  );
};

// ---------------- C: финал ----------------
export const SceneFinal: React.FC = () => {
  const f = useCurrentFrame();
  const fin = config.final;
  const join = sp(f, 0.1, "gentle");
  const one = tw(f, 0.45, 0.9);
  const icons = ["nutrition", "finance", "gym"] as const;
  const cta = appear(f, 2.1, 18, 0.4);
  return (
    <div style={{ position: "absolute", inset: 0, fontFamily: FONT_SANS, color: C.text, textAlign: "center" }}>
      <div style={{ position: "absolute", top: 270, left: 0, right: 0, fontSize: 76, fontWeight: 560, letterSpacing: "-0.03em", ...appear(f, 0, 14, 0.4) }}>{fin.title}</div>
      <div style={{ position: "absolute", top: 400, left: 90, width: 900, height: 280 }}>
        <Glass radius={40} strong style={{ position: "absolute", inset: 0, opacity: one }} />
        {fin.modules.map((m, i) => {
          const spread = (i - 1) * 140 * (1 - join);
          return (
            <React.Fragment key={m}>
              <div style={{ position: "absolute", top: 0, left: i * 300, width: 300, height: 280, transform: `translateX(${spread}px) translateY(${(1 - join) * (i === 1 ? -60 : 60)}px)`, opacity: Math.min(1, join * 2) }}>
                <Glass radius={36} style={{ position: "absolute", inset: 14, opacity: 1 - one }} />
                <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20 }}>
                  <div style={{ color: C.accent }}><Icon name={icons[i]} size={86} /></div>
                  <div style={{ fontSize: 48, fontWeight: 520, letterSpacing: "-0.02em" }}>{m}</div>
                </div>
              </div>
              {i > 0 && <div style={{ position: "absolute", left: i * 300, top: 56, width: 2, height: 168, background: C.divider, opacity: one, transform: `scaleY(${one})` }} />}
            </React.Fragment>
          );
        })}
      </div>
      <div style={{ position: "absolute", top: 740, left: 0, right: 0, fontSize: 104, fontWeight: 580, letterSpacing: "-0.035em", color: C.accent, ...appear(f, 0.8, 18, 0.45) }}>{fin.release}</div>
      <div style={{ position: "absolute", top: 900, left: 80, right: 80, fontSize: 48, lineHeight: 1.25, whiteSpace: "pre-line", color: C.text, ...appear(f, 1.2, 14, 0.4) }}>{fin.teaser}</div>
      <div style={{ position: "absolute", top: 1060, left: 110, right: 110, fontSize: 40, lineHeight: 1.25, color: C.text2, ...appear(f, 1.6, 14, 0.4) }}>{fin.keys}</div>
      <div style={{ position: "absolute", top: 1190, left: 0, right: 0, fontSize: 40, color: C.text2, ...appear(f, 1.8, 14, 0.4) }}>{fin.license}</div>
      <div style={{ position: "absolute", top: 1330, left: 40, right: 40, display: "flex", justifyContent: "center", ...cta }}>
        <div style={{ background: C.accent, color: "#fff", borderRadius: 999, padding: "32px 56px", fontSize: 44, fontWeight: 560, whiteSpace: "nowrap", boxShadow: "0 18px 44px rgba(116,43,69,.30)" }}>{fin.cta}</div>
      </div>
    </div>
  );
};

export { MONEY };
