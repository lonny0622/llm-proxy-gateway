import type { ProxyConfig } from '../types.js';

interface ProxyCardProps {
  proxy: ProxyConfig;
  onToggle: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}

export const ProxyCard: React.FC<ProxyCardProps> = ({ proxy, onToggle, onEdit, onDelete }) => {
  const typeLabels: Record<string, string> = {
    'anthropic-to-openrouter': 'Anthropic ➔ OpenRouter',
    'openrouter-to-anthropic': 'OpenRouter ➔ Anthropic',
    'responses-to-chat-completions': 'Responses ➔ Chat Completions',
  };
  const typeLabel = typeLabels[proxy.type] || proxy.type;

  const mappingKeys = Object.keys(proxy.modelMap || {});

  return (
    <div className={`proxy-card ${proxy.running ? 'running' : 'stopped'}`}>
      <div className="proxy-card-header">
        <div className="proxy-title">
          <h3>{proxy.name}</h3>
          <span className={`proxy-tag ${proxy.type}`}>{typeLabel}</span>
        </div>
        <span className={`proxy-status-badge ${proxy.running ? 'running' : 'stopped'}`}>
          <span className={`status-indicator ${proxy.running ? 'active' : 'stopped'}`}></span>
          {proxy.running ? '运行中' : '已停止'}
        </span>
      </div>

      <div className="proxy-meta-list">
        <div className="proxy-meta-item">
          <span>监听端口:</span>
          <span className="value">{proxy.port}</span>
        </div>
        <div className="proxy-meta-item">
          <span>本地地址:</span>
          <span className="value font-mono">http://localhost:{proxy.port}</span>
        </div>
        <div className="proxy-meta-item">
          <span>目标地址:</span>
          <span className="value" title={proxy.targetUrl || '官方默认'}>
            {proxy.targetUrl ? (proxy.targetUrl.length > 25 ? proxy.targetUrl.slice(0, 25) + '...' : proxy.targetUrl) : '官方默认'}
          </span>
        </div>
        <div className="proxy-meta-item">
          <span>预设密钥:</span>
          <span className="value font-mono">
            {proxy.apiKey ? `••••••••••••${proxy.apiKey.slice(-4)}` : '从客户端头部读取'}
          </span>
        </div>
      </div>

      <div className="proxy-mappings-summary">
        {mappingKeys.length > 0 ? (
          mappingKeys.map(src => (
            <div key={src}>
              <span className="src" title={src}>{src}</span>
              <span className="arrow">➔</span>
              <span className="dest" title={proxy.modelMap[src]}>{proxy.modelMap[src]}</span>
            </div>
          ))
        ) : (
          <div className="text-muted" style={{ textAlign: 'center' }}>
            默认模型转发（无规则）
          </div>
        )}
      </div>

      <div className="proxy-card-actions">
        <button
          className={`btn ${proxy.running ? 'btn-danger' : 'btn-primary'} btn-sm`}
          onClick={() => onToggle(proxy.id)}
        >
          {proxy.running ? '停止' : '启动'}
        </button>
        <button className="btn btn-secondary btn-sm" onClick={() => onEdit(proxy.id)}>
          编辑
        </button>
        <button className="btn btn-danger btn-sm" onClick={() => onDelete(proxy.id)}>
          删除
        </button>
      </div>
    </div>
  );
};
