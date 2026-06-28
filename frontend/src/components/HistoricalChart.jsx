import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

function HistoricalChart({ device, data }) {
  const displayUnit = device.unit && device.unit !== 'continuous' && device.unit !== 'switch' ? device.unit : ''
  return (
    <div className="historical-chart">
      <h4 className="chart-title">
        {device.name} {displayUnit && `(${displayUnit})`} — History
      </h4>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis
            dataKey="timestamp"
            tick={{ fontSize: 11, fill: '#718096' }}
            tickFormatter={(t) => {
              const d = new Date(t)
              return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
            }}
            interval="preserveStartEnd"
          />
          <YAxis tick={{ fontSize: 11, fill: '#718096' }} />
          <Tooltip
            labelFormatter={(t) => new Date(t).toLocaleString()}
            formatter={(val) => [val, device.name]}
            contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12 }}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke="#3182ce"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: '#3182ce' }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export default HistoricalChart
