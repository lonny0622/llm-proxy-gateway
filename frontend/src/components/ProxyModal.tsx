import { useState, useEffect, useRef } from 'react';
import type { ProxyConfig, ModelMap } from '../types.js';

interface ProxyModalProps {
  isOpen: boolean;
  proxy: ProxyConfig | null; // null for add mode, ProxyConfig for edit mode
  onClose: () => void;
  onSave: (payload: {
    id?: string;
    name: string;
    port: number;
    type: 'anthropic-to-openrouter' | 'openrouter-to-anthropic' | 'responses-to-chat-completions';
    apiKey: string;
    targetUrl: string;
    modelMap: ModelMap;
  }) => Promise<void>;
}

interface MappingItem {
  id: string;
  source: string;
  target: string;
}

export const ProxyModal: React.FC<ProxyModalProps> = ({ isOpen, proxy, onClose, onSave }) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  
  // Form fields state
  const [name, setName] = useState('');
  const [port, setPort] = useState<number | ''>('');
  const [type, setType] = useState<'anthropic-to-openrouter' | 'openrouter-to-anthropic' | 'responses-to-chat-completions'>('anthropic-to-openrouter');
  const [apiKey, setApiKey] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [mappings, setMappings] = useState<MappingItem[]>([
    { id: Math.random().toString(), source: '', target: '' }
  ]);

  // Sync form states with proxy prop
  useEffect(() => {
    if (proxy) {
      setName(proxy.name);
      setPort(proxy.port);
      setType(proxy.type);
      setApiKey(proxy.apiKey || '');
      setTargetUrl(proxy.targetUrl || '');
      
      const modelMapKeys = Object.keys(proxy.modelMap || {});
      if (modelMapKeys.length > 0) {
        setMappings(modelMapKeys.map(k => ({
          id: Math.random().toString(),
          source: k,
          target: proxy.modelMap[k]
        })));
      } else {
        setMappings([{ id: Math.random().toString(), source: '', target: '' }]);
      }
    } else {
      setName('');
      setPort('');
      setType('anthropic-to-openrouter');
      setApiKey('');
      setTargetUrl('');
      setMappings([{ id: Math.random().toString(), source: '', target: '' }]);
    }
  }, [proxy, isOpen]);

  // Open / Close modal using native dialog API
  useEffect(() => {
    const dialogObj = dialogRef.current;
    if (!dialogObj) return;

    if (isOpen) {
      if (!dialogObj.open) {
        dialogObj.showModal();
      }
    } else {
      if (dialogObj.open) {
        dialogObj.close();
      }
    }
  }, [isOpen]);

  const addMappingRow = () => {
    setMappings([...mappings, { id: Math.random().toString(), source: '', target: '' }]);
  };

  const removeMappingRow = (id: string) => {
    setMappings(mappings.filter(m => m.id !== id));
  };

  const updateMappingRow = (id: string, field: 'source' | 'target', value: string) => {
    setMappings(mappings.map(m => m.id === id ? { ...m, [field]: value } : m));
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    // Backdrop clicks target the <dialog> element itself, not its children content
    if (e.target === dialogRef.current) {
      onClose();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!port) return;

    const modelMap: ModelMap = {};
    mappings.forEach(m => {
      const src = m.source.trim();
      const dest = m.target.trim();
      if (src && dest) {
        modelMap[src] = dest;
      }
    });

    await onSave({
      id: proxy?.id,
      name,
      port: Number(port),
      type,
      apiKey,
      targetUrl,
      modelMap
    });
  };

  return (
    <dialog
      ref={dialogRef}
      onClick={handleBackdropClick}
      className="glass-modal"
      onClose={onClose}
    >
      <div className="modal-content">
        <div className="modal-header">
          <h3>{proxy ? '编辑代理实例' : '创建代理实例'}</h3>
          <button className="btn-close" onClick={onClose} type="button">×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="proxy-name">实例名称</label>
            <input
              type="text"
              id="proxy-name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="例如: Claude 3.5 Sonnet 转换代理"
              required
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="proxy-port">代理监听端口</label>
              <input
                type="number"
                id="proxy-port"
                value={port}
                onChange={e => setPort(e.target.value ? Number(e.target.value) : '')}
                min="1024"
                max="65535"
                placeholder="例如: 9001"
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="proxy-type">代理类型 (转换方向)</label>
              <select
                id="proxy-type"
                value={type}
                onChange={e => setType(e.target.value as any)}
                required
              >
                <option value="anthropic-to-openrouter">Anthropic ➔ OpenRouter (OpenAI)</option>
                <option value="openrouter-to-anthropic">OpenRouter (OpenAI) ➔ Anthropic</option>
                <option value="responses-to-chat-completions">Responses API ➔ Chat Completions (Codex)</option>
              </select>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="proxy-key">默认目标 API Key (选填)</label>
            <input
              type="password"
              id="proxy-key"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="不填则在调用时代入客户端 Request Header 中的 Key"
            />
            <p className="form-tip">如果填入此项，任何发往该端口的请求都将强制使用此 Key</p>
          </div>

          <div className="form-group">
            <label htmlFor="proxy-target-url">自定义目标 Base URL / Endpoint (选填)</label>
            <input
              type="text"
              id="proxy-target-url"
              value={targetUrl}
              onChange={e => setTargetUrl(e.target.value)}
              placeholder="例如: https://api.openai-hk.com/v1/chat/completions"
            />
            <p className="form-tip">留空则自动选用官方接口。请输入完整的聊天补全接口地址。</p>
          </div>

          <div className="form-group">
            <div className="model-map-header">
              <label>模型映射规则 (Model Mappings)</label>
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                onClick={addMappingRow}
              >
                + 添加规则
              </button>
            </div>
            <div className="model-mappings-list">
              {mappings.map(row => (
                <div key={row.id} className="mapping-row form-group">
                  <input
                    type="text"
                    placeholder="源模型"
                    value={row.source}
                    onChange={e => updateMappingRow(row.id, 'source', e.target.value)}
                    required
                  />
                  <input
                    type="text"
                    placeholder="目标模型"
                    value={row.target}
                    onChange={e => updateMappingRow(row.id, 'target', e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="btn btn-danger btn-xs"
                    onClick={() => removeMappingRow(row.id)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              取消
            </button>
            <button type="submit" className="btn btn-primary">
              保存配置
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
};
