import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { fmt } from '../../utils/market.js';
import { fmtCompact } from '../../lib/positionStatus.js';

/**
 * The recharts growth curve, split into its own chunk.
 *
 * recharts (with its d3 dependencies) is the single heaviest thing in the
 * frontend bundle. It is only ever drawn inside the collapsed GROWTH section
 * of the portfolio tab, which most users will not expand on a given visit. So
 * we lazy-load it: the chart code is fetched the first time someone opens the
 * section, not on the cold first paint that every user pays for on cellular.
 *
 * Default export is required for React.lazy(). Keep this file's imports to just
 * recharts + the two formatters so nothing else gets dragged into the chunk.
 */
export default function GrowthChartCanvas({ chartData, hasSpy }) {
  return (
    <div style={{ marginTop: 4, padding: '8px 0', height: 200 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 6, right: 8, left: -10, bottom: 0 }}>
          <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--faint)' }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 9, fill: 'var(--faint)' }} tickFormatter={fmtCompact} />
          <Tooltip
            contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', fontSize: 11 }}
            labelStyle={{ color: 'var(--muted)' }}
            formatter={(v) => '$' + fmt(v)}
          />
          {hasSpy && <Line type="monotone" dataKey="spy" stroke="var(--faint)" strokeWidth={1.5} strokeDasharray="4 3" dot={false} name="S&P 500" />}
          <Line type="monotone" dataKey="value" stroke="var(--blue)" strokeWidth={2} dot={false} name="You" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
