import type { AdminCharts, Chart } from "@/server/admin/charts";
import type { HourState, UptimeSummary } from "@/server/admin/uptime";

/** Series colours: burgundy first, then distinguishable tones; the legend always names them, colour is never the only carrier. */
const COLORS = ["#7a1f3d", "#d08aa0", "#8a7a7e"];
const STATE_NAMES: Record<HourState, string> = { up: "работал", degraded: "с ошибками cron", down: "пропуск", unknown: "нет данных" };

const W = 320;
const H = 120;

/** Stacked bars drawn in SVG; the screen reader gets the totals instead of the picture. */
export function BarChart({ title, chart, unit }: { title: string; chart: Chart; unit: string }) {
  const count = chart.labels.length;
  const totals = chart.labels.map((_, index) => chart.series.reduce((sum, series) => sum + (series.values[index] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const sum = totals.reduce((a, b) => a + b, 0);
  const peak = totals.indexOf(Math.max(...totals));
  const step = W / count;
  const label = `${title}: всего ${sum}${sum > 0 ? `, максимум ${totals[peak]} (${chart.labels[peak]})` : ""}. ${chart.series.map((series) => `${series.name}: ${series.values.reduce((a, b) => a + b, 0)}`).join("; ")}.`;
  return (
    <figure className="chart">
      <figcaption>{title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} preserveAspectRatio="none">
        <line x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} stroke="rgba(122,31,61,0.25)" />
        {chart.labels.map((name, index) => {
          let y = H;
          return (
            <g key={name + index}>
              {chart.series.map((series, seriesIndex) => {
                const value = series.values[index] ?? 0;
                if (value === 0) return null;
                const height = (value / max) * (H - 4);
                y -= height;
                return <rect key={series.key} x={index * step + step * 0.15} y={y} width={step * 0.7} height={height} fill={COLORS[seriesIndex % COLORS.length]}><title>{`${name} · ${series.name}: ${value}`}</title></rect>;
              })}
            </g>
          );
        })}
      </svg>
      <div className="chart-axis" aria-hidden="true"><span>{chart.labels[0]}</span><span>максимум {Math.max(...totals)} {unit}</span><span>{chart.labels[count - 1]}</span></div>
      <ul className="legend">{chart.series.map((series, index) => <li key={series.key}><i style={{ background: COLORS[index % COLORS.length] }} />{series.name}</li>)}</ul>
    </figure>
  );
}

const CELL_FILL: Record<HourState, string> = { up: "#1b6e3c", degraded: "#c9871f", down: "#b3261e", unknown: "rgba(138,122,126,0.3)" };

/** Strip of hourly cells (7 days) and a second one with daily shares (90 days). */
export function UptimeView({ uptime }: { uptime: UptimeSummary }) {
  const show = (value: number | null) => (value === null ? "—" : `${value}%`);
  const cell = (n: number) => W / n;
  return (
    <>
      <div className="panel">
        <div className="row"><span>24 часа</span><span className="big">{show(uptime.day)}</span></div>
        <div className="row"><span>7 дней</span><span className="big">{show(uptime.week)}</span></div>
        <div className="row"><span>30 дней</span><span>{show(uptime.month)}</span></div>
        <div className="row"><span>90 дней</span><span>{show(uptime.quarter)}</span></div>
        <div className="row"><span>Пропущено часов за 7 дней / с ошибками cron</span><span className={uptime.missedHours7d ? "bad" : ""}>{uptime.missedHours7d} / {uptime.degradedHours7d}</span></div>
        <p className="muted">Час считается рабочим, если внешний планировщик достучался до сервиса хотя бы раз (cron каждые 30 минут). История с {uptime.firstRunAt ? new Date(uptime.firstRunAt).toLocaleDateString("ru-RU") : "— (запусков ещё не было)"}; до этого данных нет, а не простой.</p>
      </div>
      <figure className="chart">
        <figcaption>Последние 7 дней по часам</figcaption>
        <svg viewBox={`0 0 ${W} 24`} role="img" aria-label={`Аптайм по часам за 7 дней: ${uptime.hours.filter((s) => s === "up").length} часов работал, ${uptime.missedHours7d} пропусков, ${uptime.degradedHours7d} с ошибками.`} preserveAspectRatio="none">
          {uptime.hours.map((state, index) => <rect key={index} x={index * cell(168)} y="0" width={cell(168) * 0.8} height="24" fill={CELL_FILL[state]}><title>{STATE_NAMES[state]}</title></rect>)}
        </svg>
        <div className="chart-axis" aria-hidden="true"><span>7 дней назад</span><span>сейчас</span></div>
      </figure>
      <figure className="chart">
        <figcaption>Последние 90 дней по суткам</figcaption>
        <svg viewBox={`0 0 ${W} 24`} role="img" aria-label={`Аптайм по суткам за 90 дней; за 90 дней ${show(uptime.quarter)}.`} preserveAspectRatio="none">
          {uptime.days.map((day, index) => {
            const fill = day.percent === null ? CELL_FILL.unknown : day.percent >= 99 ? CELL_FILL.up : day.percent >= 90 ? CELL_FILL.degraded : CELL_FILL.down;
            return <rect key={day.date} x={index * cell(90)} y="0" width={cell(90) * 0.8} height="24" fill={fill}><title>{`${day.date}: ${show(day.percent)}`}</title></rect>;
          })}
        </svg>
        <ul className="legend">
          <li><i style={{ background: CELL_FILL.up }} />работал (сутки от 99%)</li>
          <li><i style={{ background: CELL_FILL.degraded }} />частично</li>
          <li><i style={{ background: CELL_FILL.down }} />простой</li>
          <li><i style={{ background: CELL_FILL.unknown }} />нет данных</li>
        </ul>
      </figure>
    </>
  );
}

export function ChartsView({ charts }: { charts: AdminCharts }) {
  return (
    <>
      <BarChart title="Нагрузка: последние 48 часов по часам (UTC)" chart={charts.load} unit="в час" />
      <BarChart title="Ошибки: последние 14 дней по дням (UTC)" chart={charts.errors} unit="в день" />
      <BarChart title="События: записи за 30 дней по дням (UTC)" chart={charts.events} unit="в день" />
    </>
  );
}
