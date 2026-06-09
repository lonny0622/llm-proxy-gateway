import React, { useState } from 'react';

export const Playground: React.FC = () => {
  const [type, setType] = useState<'anthropic-to-openrouter' | 'openrouter-to-anthropic' | 'responses-to-chat-completions'>('anthropic-to-openrouter');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('claude-3-5-sonnet-20241022');
  const [targetModel, setTargetModel] = useState('anthropic/claude-3.5-sonnet');
  const [message, setMessage] = useState('你好！请问你是谁？请用一句话回答。');
  
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'request' | 'response' | 'raw'>('request');
  
  // Results states
  const [requestPayload, setRequestPayload] = useState<string>('// 等待请求发送...');
  const [responsePayload, setResponsePayload] = useState<string>('// 等待请求发送...');
  const [rawResponsePayload, setRawResponsePayload] = useState<string>('// 等待请求发送...');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim()) {
      alert('请输入测试 API Key！');
      return;
    }

    setLoading(true);
    setRequestPayload('// 正在准备请求报文...');
    setResponsePayload('// 正在转换输出响应...');
    setRawResponsePayload('// 正在获取目标 API 响应...');

    try {
      const res = await fetch('/api/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, apiKey, model, targetModel, message })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Playground request failed');
      }

      const data = await res.json();

      setRequestPayload(JSON.stringify(data.translatedRequest, null, 2));
      
      if (data.success) {
        setRawResponsePayload(JSON.stringify(data.rawResponse, null, 2));
        setResponsePayload(JSON.stringify(data.translatedResponse, null, 2));
      } else {
        setRawResponsePayload(JSON.stringify(data.rawResponse || { error: 'Test failed' }, null, 2));
        setResponsePayload(`// 测试失败\nError: ${data.error}`);
      }
    } catch (err: any) {
      console.error(err);
      setRequestPayload('// 失败');
      setResponsePayload('// 失败');
      setRawResponsePayload(`Error during request execution:\n${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="playground-layout">
      <div className="playground-config panel">
        <h3>测试配置</h3>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="play-type">转换方向</label>
            <select
              id="play-type"
              value={type}
              onChange={e => setType(e.target.value as any)}
              required
            >
              <option value="anthropic-to-openrouter">Anthropic 格式 ➔ OpenRouter (OpenAI 格式)</option>
              <option value="openrouter-to-anthropic">OpenRouter (OpenAI 格式) ➔ Anthropic 格式</option>
              <option value="responses-to-chat-completions">Responses 格式 ➔ Chat Completions (OpenAI 格式)</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="play-key">API 密钥 (API Key)</label>
            <input
              type="password"
              id="play-key"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="输入目标 API 密钥（将安全地用于本地测试请求）"
              required
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="play-model">输入模型 (源)</label>
              <input
                type="text"
                id="play-model"
                value={model}
                onChange={e => setModel(e.target.value)}
                placeholder="e.g. claude-3-5-sonnet"
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="play-target-model">映射模型 (目标)</label>
              <input
                type="text"
                id="play-target-model"
                value={targetModel}
                onChange={e => setTargetModel(e.target.value)}
                placeholder="e.g. anthropic/claude-3.5-sonnet"
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="play-message">测试消息 (Prompt)</label>
            <textarea
              id="play-message"
              value={message}
              onChange={e => setMessage(e.target.value)}
              rows={4}
              placeholder="向 AI 发送一条消息以测试转换与连通性..."
              required
            />
          </div>

          <button type="submit" className="btn btn-primary w-100" disabled={loading}>
            {loading ? '请求处理中...' : '发送测试请求'}
          </button>
        </form>
      </div>

      <div className="playground-results">
        <div className="results-tabs">
          <button
            className={`result-tab-btn ${activeTab === 'request' ? 'active' : ''}`}
            onClick={() => setActiveTab('request')}
          >
            请求报文转换 (Request)
          </button>
          <button
            className={`result-tab-btn ${activeTab === 'response' ? 'active' : ''}`}
            onClick={() => setActiveTab('response')}
          >
            响应报文转换 (Response)
          </button>
          <button
            className={`result-tab-btn ${activeTab === 'raw' ? 'active' : ''}`}
            onClick={() => setActiveTab('raw')}
          >
            原始响应 (Raw Response)
          </button>
        </div>
        
        <div className="result-content-container panel">
          {activeTab === 'request' && (
            <div className="result-tab-pane active">
              <div className="pane-subheader">
                <span>将发送给目标 API 的格式化载荷：</span>
              </div>
              <pre><code className="json-code">{requestPayload}</code></pre>
            </div>
          )}
          
          {activeTab === 'response' && (
            <div className="result-tab-pane active">
              <div className="pane-subheader">
                <span>客户端接收到的最终代理格式响应：</span>
              </div>
              <pre><code className="json-code">{responsePayload}</code></pre>
            </div>
          )}

          {activeTab === 'raw' && (
            <div className="result-tab-pane active">
              <div className="pane-subheader">
                <span>目标 API 返回的原始 JSON 响应：</span>
              </div>
              <pre><code className="json-code">{rawResponsePayload}</code></pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
