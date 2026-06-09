import React from 'react';

interface HeaderProps {
  dashboardPort: number;
}

export const Header: React.FC<HeaderProps> = ({ dashboardPort }) => {
  return (
    <header className="app-header">
      <div className="logo-area">
        <div className="logo-icon">⇄</div>
        <div>
          <h1>LLM API 代理网关</h1>
          <p className="subtitle">Anthropic ⇄ OpenRouter API 双向转换与路由系统 (TS & React)</p>
        </div>
      </div>
      <div className="system-status">
        <span className="status-indicator active"></span>
        <span className="status-text">主管理器已运行 (Port: <span>{dashboardPort}</span>)</span>
      </div>
    </header>
  );
};
