import React from "react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

const DemographicsRechart = ({ data, isDarkMode }) => {
  if (!data || Object.keys(data).length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500 dark:text-gray-400">
        <p>No data available.</p>
      </div>
    );
  }

  const chartData = [
    { name: "Female", value: data.Female || 0 },
    { name: "Male", value: data.Male || 0 },
  ].filter((item) => item.value > 0);

  const COLORS = ["#E91E63", "#426EEA", "#6B7280"];

  const RADIAN = Math.PI / 180;
  const renderCustomizedLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }) => {
    const radius = innerRadius + (outerRadius - innerRadius) * 0.6;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);

    return (
      <text
        x={x}
        y={y}
        fill="white"
        textAnchor="middle"
        dominantBaseline="central"
        fontWeight="bold"
        fontSize={16}
      >
      </text>
    );
  };

  return (
    <div className="w-full h-full">
      <ResponsiveContainer>
        <PieChart>
          <Pie
            data={chartData}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius="100%"
            startAngle={90}
            endAngle={-270}
            labelLine={false}
            label={renderCustomizedLabel}
          >
            {chartData.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={COLORS[index % COLORS.length]}
              />
            ))}
          </Pie>
          <Tooltip
            formatter={(value, name, props) => {
              const total = chartData.reduce((sum, entry) => sum + entry.value, 0);
              const percent = ((value / total) * 100).toFixed(1);
              return [`${value} (${percent}%)`, name];
            }}
            // --- MODIFIED: Tooltip is now always light for high contrast ---
            contentStyle={{
              backgroundColor: "#ffffff", // Always white background
              border: "1px solid",
              borderColor: "#e5e7eb", // Always light grey border
              color: "#374151", // Always dark grey text
              fontSize: "12px",
              padding: "6px 8px",
              borderRadius: "0.375rem", // Added rounded corners
            }}
            itemStyle={{
              fontSize: "12px",
            }}
          />
          <Legend
            verticalAlign="bottom"
            wrapperStyle={{
              color: isDarkMode ? "#e5e7eb" : "#374151",
            }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
};

export default DemographicsRechart;
