"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Link } from "@/components/ui";
import type { AdminOverview } from "@/server/admin/overview";
import type { AdminStats } from "@/server/admin/stats";
import type { AdminCharts } from "@/server/admin/charts";
import type { UptimeSummary } from "@/server/admin/uptime";
import { ChartsView, UptimeView } from "./charts";
import "./admin.css";

type TelegramWebApp = {
  initData?: string;
  ready(): void;
  expand(): void;
  safeAreaInset?: { top: number; bottom: number };
  contentSafeAreaInset?: { top: number; bottom: number };
};

const MODULE_NAMES: Record<string, string> = { nutrition: "Питание", finance: "Финансы", gym: "Зал" };
const FAILURE_NAMES: Record<string, string> = {
  quota_exceeded: "лимит (429)", unavailable: "сбой/таймаут", credits_exhausted: "кредиты", configuration: "настройка", invalid_response: "ответ не разобран", other: "прочее", unknown: "без типа",
};

const shown = (value: number | string | null | undefined) => (value === null || value === undefined ? "—" : String(value));
const share = (item: { count: number; share: number | null }) => `${item.count} · ${item.share === null ? "—" : `${item.share}%`}`;

export default function AdminApp() {
  const [initData, setInitData] = useState<string | null>(null);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [charts, setCharts] = useState<{ charts: AdminCharts; uptime: UptimeSummary } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Telegram's initData exists only in the browser; the work starts after the first tick so no state is set synchronously.
  useEffect(() => {
    void (async () => {
      await Promise.resolve();
      const webApp = (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
      if (!webApp?.initData) {
        setError("Откройте админ-панель через админ-бота в Telegram.");
        return;
      }
      webApp.ready();
      webApp.expand();
      // System inset and Telegram's own controls stack.
      const top = Math.max(0, webApp.safeAreaInset?.top ?? 0) + Math.max(0, webApp.contentSafeAreaInset?.top ?? 0);
      const bottom = Math.max(0, webApp.safeAreaInset?.bottom ?? 0) + Math.max(0, webApp.contentSafeAreaInset?.bottom ?? 0);
      document.documentElement.style.setProperty("--lifeos-inset-top", `${top}px`);
      document.documentElement.style.setProperty("--lifeos-inset-bottom", `max(${bottom}px, env(safe-area-inset-bottom, 0px))`);
      setInitData(webApp.initData);
    })();
  }, []);

  const call = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(path, { ...init, headers: { authorization: `tma ${initData}`, "content-type": "application/json" } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(response.status === 403 ? "Доступ запрещён." : (body as { error?: string }).error ?? "Ошибка запроса.");
    return body as T;
  }, [initData]);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [nextOverview, nextStats] = await Promise.all([call<AdminOverview>("/api/admin/overview"), call<AdminStats | null>("/api/admin/stats")]);
      setOverview(nextOverview);
      setStats(nextStats);
      // Charts are optional: a failure here must not hide the rest of the panel.
      setCharts(await call<{ charts: AdminCharts; uptime: UptimeSummary }>("/api/admin/charts").catch(() => null));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Ошибка запроса.");
    }
  }, [call]);

  useEffect(() => {
    if (!initData) return;
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [initData, load]);

  const act = async (action: "retry_failed" | "test_alert") => {
    setBusy(true);
    try {
      const result = await call<{ requeued?: number; delivered?: boolean }>("/api/admin/actions", { method: "POST", body: JSON.stringify({ action }) });
      setNotice(action === "test_alert" ? (result.delivered ? "Тестовый алерт отправлен." : "Алерт не доставлен: проверьте ADMIN_BOT_TOKEN и ADMIN_TELEGRAM_IDS.") : `Возвращено в очередь: ${result.requeued ?? 0}.`);
      await load();
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Ошибка запроса.");
    } finally {
      setBusy(false);
    }
  };

  if (error && !overview) return <main className="admin"><h1>Админ-панель</h1><p className="bad">{error}</p></main>;
  if (!overview) return <main className="admin"><h1>Админ-панель</h1><p className="muted">Загрузка…</p></main>;

  const ready = overview.health.readiness.status === "ready";
  const cronAge = overview.cron.lastRunAgeMinutes;
  return (
    <main className="admin">
      <h1>Админ-панель</h1>
      <p className="muted">Только агрегаты и технические состояния. Обновлено {new Date(overview.generatedAt).toLocaleTimeString("ru-RU")}</p>
      {error ? <p className="bad">{error}</p> : null}
      {notice ? <p className="muted">{notice}</p> : null}

      <h2>Здоровье</h2>
      <div className="panel">
        <div className="row"><span>Версия / коммит</span><span>{overview.health.version} · {overview.health.commit ?? "—"}</span></div>
        <div className="row"><span>База и миграции</span><span className={ready ? "good" : "bad"}>{overview.health.readiness.status}</span></div>
      </div>

      <h2>Аптайм</h2>
      {charts ? <UptimeView uptime={charts.uptime} /> : <p className="muted">История недоступна.</p>}

      <h2>Графики</h2>
      {charts ? <ChartsView charts={charts.charts} /> : <p className="muted">Графики недоступны.</p>}

      <h2>Cron</h2>
      <div className="panel">
        <div className="row"><span>Последний запуск</span><span className={cronAge === null || cronAge > 90 ? "bad" : "good"}>{cronAge === null ? "не было" : `${cronAge} мин назад`}</span></div>
        {overview.cron.runs.map((run) => (
          <div className="row" key={run.startedAt}>
            <span>{new Date(run.startedAt).toLocaleString("ru-RU")}</span>
            <span className={run.ok === false ? "bad" : ""}>{run.ok === null ? "идёт/оборван" : run.ok ? "ок" : "сбой"} · {run.durationMs === null ? "—" : `${Math.round(run.durationMs / 1000)} с`} · отправлено {shown(run.sent)}{run.errorClass ? ` · ${run.errorClass}` : ""}</span>
          </div>
        ))}
      </div>

      <h2>Очередь Telegram updates</h2>
      <div className="panel">
        {["received", "processing", "failed", "processed"].map((status) => <div className="row" key={status}><span>{status}</span><span>{overview.queue.byStatus[status] ?? 0}</span></div>)}
        <div className="row"><span>Самый старый необработанный</span><span>{overview.queue.oldestPendingMinutes === null ? "—" : `${overview.queue.oldestPendingMinutes} мин`}</span></div>
        <div className="row"><span>Исчерпали попытки</span><span className={overview.queue.exhausted ? "bad" : ""}>{overview.queue.exhausted}</span></div>
        <Button variant="primary" size="sm" disabled={busy} onClick={() => act("retry_failed")}>Повторить failed</Button>
        <Button variant="primary" size="sm" disabled={busy} onClick={() => act("test_alert")}>Тестовый алерт</Button>
      </div>

      <h2>Бэкап</h2>
      <div className="panel">
        {overview.backup.latest ? (
          <div className="row"><span>{new Date(overview.backup.latest.at).toLocaleString("ru-RU")}</span><Link href={overview.backup.latest.url} external>{overview.backup.latest.conclusion ?? overview.backup.latest.status}</Link></div>
        ) : <div className="row"><span>Статус недоступен</span><Link href={overview.backup.workflowUrl} external>workflow</Link></div>}
      </div>

      <h2>ИИ за 24 часа</h2>
      <div className="panel">
        <div className="row"><span>Успешные запросы</span><span>{overview.ai.success24h}</span></div>
        {overview.ai.failures24h.map((item) => <div className="row" key={item.kind}><span>Отказ: {FAILURE_NAMES[item.kind] ?? item.kind}</span><span>{item.count}</span></div>)}
      </div>

      <h2>Квоты и rate limit</h2>
      <div className="panel">
        {overview.quotas.limits.map((limit) => <div className="row" key={limit.bucket}><span>{limit.bucket} · {limit.limit}/{limit.windowSeconds} с</span><span className={limit.exceeded24h ? "bad" : ""}>превышений за 24 ч: {limit.exceeded24h}</span></div>)}
        <p className="muted">{overview.quotas.neon}</p>
      </div>

      <h2>Статистика пользователей</h2>
      {stats ? <StatsView stats={stats} /> : <p className="muted">Агрегаты ещё не посчитаны.</p>}
    </main>
  );
}

function StatsView({ stats }: { stats: AdminStats }) {
  const a = stats.audience;
  return (
    <>
      <p className="muted">Считается раз в сутки · {new Date(stats.computedAt).toLocaleString("ru-RU")}. Значения меньше 5 скрыты.</p>
      <div className="panel">
        <div className="row"><span>Всего</span><span className="big">{a.total}</span></div>
        <div className="row"><span>Новые: день / неделя / месяц</span><span>{a.newDay} / {a.newWeek} / {a.newMonth}</span></div>
        <div className="row"><span>DAU / WAU / MAU</span><span>{a.dau} / {a.wau} / {a.mau}</span></div>
      </div>
      <h2>Регистрации по дням</h2>
      <div className="panel">{a.registrationsByDay.length ? a.registrationsByDay.map((day) => <div className="row" key={day.date}><span>{day.date}</span><span>{day.count}</span></div>) : <span className="muted">Нет данных</span>}</div>
      <h2>Удержание по неделям регистрации</h2>
      <div className="panel">
        {stats.retention.map((cohort) => <div className="row" key={cohort.cohortWeek}><span>{cohort.cohortWeek} · {cohort.size}</span><span>д1 {share(cohort.day1)} · д7 {share(cohort.day7)} · д30 {share(cohort.day30)}</span></div>)}
      </div>
      <h2>Онбординг</h2>
      <div className="panel">
        <div className="row"><span>Согласие</span><span>{share(stats.onboarding.consent)}</span></div>
        <div className="row"><span>Профиль</span><span>{share(stats.onboarding.profile)}</span></div>
        <div className="row"><span>Первая запись</span><span>{share(stats.onboarding.firstEntry)}</span></div>
        <div className="row"><span>Подключён ИИ</span><span>{share(stats.onboarding.aiConnected)}</span></div>
      </div>
      <h2>Модули</h2>
      <div className="panel">
        {stats.modules.map((item) => <div className="row" key={item.module}><span>{MODULE_NAMES[item.module] ?? item.module}</span><span>включили {share(item.enabled)} · активны 30 д {share(item.active30d)} · записей/день {item.entriesPerDay7d}</span></div>)}
      </div>
      <h2>Каналы ввода (30 дней, питание и финансы)</h2>
      <div className="panel">
        <div className="row"><span>Бот</span><span>{share(stats.channels.chat)}</span></div>
        <div className="row"><span>Mini App</span><span>{share(stats.channels.miniApp)}</span></div>
        <div className="row"><span>Шаблоны и регулярные</span><span>{share(stats.channels.other)}</span></div>
        <p className="muted">Разделение «через ИИ / без ИИ» внутри бота не хранится.</p>
      </div>
      <h2>ИИ</h2>
      <div className="panel">
        <div className="row"><span>С подключённым ключом</span><span>{share(stats.ai.withKeys)}</span></div>
        {stats.ai.byProvider.map((item) => <div className="row" key={item.provider}><span>{item.provider}</span><span>{share(item.users)}</span></div>)}
        <div className="row"><span>Успешные разборы за 7 дней</span><span>{stats.ai.events7d.success}</span></div>
        {stats.ai.events7d.failures.map((item) => <div className="row" key={item.kind}><span>Отказ: {FAILURE_NAMES[item.kind] ?? item.kind}</span><span>{item.count}</span></div>)}
      </div>
      <h2>Часовые пояса и валюты</h2>
      <div className="panel">
        {stats.slices.timezones.map((item) => <div className="row" key={item.value}><span>{item.value}</span><span>{share(item.users)}</span></div>)}
        {stats.slices.currencies.map((item) => <div className="row" key={`c-${item.value}`}><span>{item.value}</span><span>{share(item.users)}</span></div>)}
      </div>
    </>
  );
}
