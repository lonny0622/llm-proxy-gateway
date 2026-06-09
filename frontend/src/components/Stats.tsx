import React from 'react';

interface StatsProps {
  total: number;
  running: number;
  stopped: number;
}

export const Stats: React.FC<StatsProps> = ({ total, running, stopped }) => {
  return (
    <div className="stats-row">
      <div className="stat-card">
        <div className="stat-label">总代理数</div>
        <div className="stat-value">{total}</div>
      </div>
      <div className="stat-card">
        <div className="stat-label">已启动</div>
        <div className="stat-value text-success">{running}</div>
      </div>
      <div className="stat-card">
        <div className="stat-label">待机中</div>
        <div className="stat-value text-warning">{stopped}</div>
      </div>
    </div>
  );
};
