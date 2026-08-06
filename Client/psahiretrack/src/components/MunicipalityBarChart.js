import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

// A vibrant, attractive color palette
const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#FF5733'];

const MunicipalityBarChart = ({ data, isDarkMode }) => {
    if (!data || Object.keys(data).length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500 dark:text-gray-400">
        <p>No data available.</p>
      </div>
    );
  }
    const chartData = Object.keys(data).map(key => ({
        name: key,
        Employees: data[key]
    })).sort((a, b) => b.Employees - a.Employees);

    const tickColor = isDarkMode ? '#A0AEC0' : '#4A5568';
    const gridStrokeColor = isDarkMode ? '#4A5568' : '#E2E8F0';

    return (
        <ResponsiveContainer width="100%" height="100%">
            <BarChart
                data={chartData}
                margin={{
                    top: 20,
                    right: 20,
                    left: -10,
                    bottom: 20, 
                }}
            >
                <CartesianGrid strokeDasharray="3 3" stroke={gridStrokeColor} />
                <XAxis 
                    dataKey="name" 
                    tick={{ fill: tickColor, fontSize: 12 }}
                    angle={-45}
                    textAnchor="end"
                    interval={0}
                />
                <YAxis tick={{ fill: tickColor }} />
                
                <Tooltip
                    cursor={{ fill: isDarkMode ? 'rgba(74, 85, 104, 0.5)' : 'rgba(226, 232, 240, 0.5)' }}
                    // --- MODIFIED: Tooltip is now always light for high contrast ---
                    contentStyle={{
                        backgroundColor: "#ffffff",      // Always white background
                        border: "1px solid",
                        borderColor: "#e5e7eb",      // Always light grey border
                        color: "#374151",            // Always dark grey text
                        borderRadius: "0.375rem",     // Added rounded corners
                        padding: "4px 12px"           // Adjusted padding
                    }}
                />
                
                <Bar dataKey="Employees">
                    {chartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                </Bar>

            </BarChart>
        </ResponsiveContainer>
    );
};

export default MunicipalityBarChart;
