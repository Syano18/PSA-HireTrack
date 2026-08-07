import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

const COLORS = ["#22C55E", "#60A5FA", "#FBBF24", "#F97316", "#EF4444", "#9CA3AF"];

// --- MODIFIED: Changed "N/A" to "Not Rated" in the logical order ---
const RATING_ORDER = ["Outstanding", "Very Satisfactory", "Satisfactory", "Unsatisfactory", "Poor", "Not Rated"];

const PerformanceRatingsChart = ({ data, isDarkMode }) => {
    if (!data || Object.keys(data).length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500 dark:text-gray-400">
        <p>No data available.</p>
      </div>
    );
  }
    const chartData = Object.keys(data).map(key => ({
        name: key,
        Count: data[key]
    }))
    .sort((a, b) => RATING_ORDER.indexOf(a.name) - RATING_ORDER.indexOf(b.name));

    const tickColor = isDarkMode ? '#FFFFFF' : '#4A5568';
    const gridStrokeColor = isDarkMode ? '#A0AEC0' : '#E2E8F0';

    return (
        <ResponsiveContainer width="100%" height="100%">
            <BarChart 
                layout="vertical" 
                data={chartData} 
                margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
            >
                <CartesianGrid strokeDasharray="3 3" stroke={gridStrokeColor} />
                <XAxis type="number" allowDecimals={false} tick={{ fill: tickColor }} />
                
                <YAxis 
                    type="category" 
                    dataKey="name" 
                    tick={{ fill: tickColor, fontSize: 12 }} 
                    width={110}
                />
                <Tooltip
                    cursor={{ fill: 'rgba(206, 212, 218, 0.3)' }}
                    contentStyle={{
                        backgroundColor: "#ffffff",
                        border: "1px solid",
                        borderColor: "#e5e7eb",
                        color: "#374151",
                        borderRadius: "0.375rem",
                    }}
                />
                <Bar dataKey="Count">
                    {chartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[RATING_ORDER.indexOf(entry.name)]} />
                    ))}
                </Bar>
            </BarChart>
        </ResponsiveContainer>
    );
};

export default PerformanceRatingsChart;
