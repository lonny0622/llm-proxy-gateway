import { useState } from 'react';
import type { LogItem } from '../types.js';

interface LogsConsoleProps {
  logs: LogItem[];
  onClear: () => void;
}

export const LogsConsole: React.FC<LogsConsoleProps> = ({ logs, onClear }) => {
  const [expandedLogs, setExpandedLogs] = useState<Record<string, boolean>>({});

  const toggleExpand = (id: string) => {
    setExpandedLogs(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  return (
    <div className="logs-container panel">
      <div className="pane-header">
        <h3>网关日志控制台</h3>
        <div className="log-actions">
          <button className="btn btn-secondary btn-sm" onClick={onClear}>
            清空面板
          </button>
        </div>
      </div>
      <div className="logs-console" style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', height: '100%', overflowY: 'auto' }}>
        {logs.length === 0 ? (
          <div className="log-entry system-log">
            <span className="log-time">[{new Date().toLocaleTimeString()}]</span>
            <span className="log-tag system">SYSTEM</span>
            <span className="log-message">控制面板日志监听器已初始化。等待网关请求流量...</span>
          </div>
        ) : (
          logs.map(log => {
            const time = new Date(log.timestamp).toLocaleTimeString();
            let entryClass = 'incoming-log';
            let tagText = 'IN';
            let tagClass = 'in';

            if (log.error) {
              entryClass = 'error-log';
              tagText = 'ERR';
              tagClass = 'err';
            } else if (log.direction && log.direction.includes('->')) {
              entryClass = 'outgoing-log';
              tagText = 'OUT';
              tagClass = 'out';
            }

            const typeText = log.type === 'anthropic-to-openrouter'
              ? 'Anthropic➔OpenRouter'
              : 'OpenRouter➔Anthropic';

            let summaryText = '';
            if (log.error) {
              summaryText = `[${log.proxyName}] 失败: ${log.error}`;
            } else {
              const model = log.requestBody?.model || 'Unknown model';
              summaryText = `[${log.proxyName}] 转换方向:${typeText} | 模型:${model} | 状态:${log.statusCode}`;
            }

            const isExpanded = expandedLogs[log.id] || false;

            return (
              <div key={log.id} className={`log-entry ${entryClass}`}>
                <span className="log-time">[{time}]</span>
                <span className={`log-tag ${tagClass}`}>{tagText}</span>
                <div style={{ flex: 1 }}>
                  <span
                    className="log-message"
                    style={{ cursor: 'pointer', display: 'inline-block' }}
                    onClick={() => toggleExpand(log.id)}
                  >
                    {summaryText} <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
                      {isExpanded ? '[点击折叠]' : '[点击展开Payload]'}
                    </span>
                  </span>
                  {isExpanded && (
                    <div className="log-details" style={{ width: '100%', marginTop: '0.5rem' }}>
                      <strong>请求内容 (Request Body):</strong>
                      <pre style={{ background: 'rgba(0,0,0,0.4)', padding: '0.5rem', borderRadius: '4px', overflow: 'auto', margin: '0.25rem 0' }}>
                        <code style={{ color: '#60a5fa', whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                          {JSON.stringify(log.requestBody, null, 2)}
                        </code>
                      </pre>
                      <strong style={{ marginTop: '0.5rem', display: 'block' }}>响应内容 (Response / Error):</strong>
                      <pre style={{ background: 'rgba(0,0,0,0.4)', padding: '0.5rem', borderRadius: '4px', overflow: 'auto', margin: '0.25rem 0' }}>
                        <code style={{ color: '#34d399', whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                          {JSON.stringify(log.responseData, null, 2)}
                        </code>
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
