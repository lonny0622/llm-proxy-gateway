import { useState, useEffect } from 'react';
import { Header } from './components/Header.jsx';
import { Stats } from './components/Stats.jsx';
import { ProxyCard } from './components/ProxyCard.jsx';
import { ProxyModal } from './components/ProxyModal.jsx';
import { Playground } from './components/Playground.jsx';
import { LogsConsole } from './components/LogsConsole.jsx';
import type { ProxyConfig, LogItem, ModelMap } from './types.js';

function App() {
  const [dashboardPort, setDashboardPort] = useState(9000);
  const [proxies, setProxies] = useState<ProxyConfig[]>([]);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [activeTab, setActiveTab] = useState<'proxies' | 'playground' | 'logs'>('proxies');
  
  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProxy, setEditingProxy] = useState<ProxyConfig | null>(null);

  // Fetch current config from backend
  const fetchConfig = async () => {
    try {
      const res = await fetch('/api/config');
      if (!res.ok) throw new Error('Failed to load gateway config');
      const data = await res.json();
      setProxies(data.proxies || []);
      setDashboardPort(data.dashboardPort || 9000);
    } catch (err: any) {
      console.error('Error fetching config:', err.message);
    }
  };

  // Toggle proxy state (Start / Stop)
  const handleToggleProxy = async (id: string) => {
    try {
      const res = await fetch(`/api/proxies/${id}/toggle`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to toggle proxy state');
      }
      await fetchConfig();
    } catch (err: any) {
      alert(`控制代理失败: ${err.message}`);
    }
  };

  // Delete a proxy config
  const handleDeleteProxy = async (id: string) => {
    if (!confirm('确定要删除这个代理实例吗？对应的监听服务将会被永久关闭。')) return;
    try {
      const res = await fetch(`/api/proxies/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete proxy');
      await fetchConfig();
    } catch (err: any) {
      alert(`删除代理失败: ${err.message}`);
    }
  };

  // Open Edit Modal
  const handleOpenEditModal = (id: string) => {
    const proxy = proxies.find(p => p.id === id);
    if (proxy) {
      setEditingProxy(proxy);
      setIsModalOpen(true);
    }
  };

  // Open Add Modal
  const handleOpenAddModal = () => {
    setEditingProxy(null);
    setIsModalOpen(true);
  };

  // Save Proxy Configuration (Add / Edit)
  const handleSaveProxy = async (payload: {
    id?: string;
    name: string;
    port: number;
    type: ProxyConfig['type'];
    apiKey: string;
    targetUrl: string;
    modelMap: ModelMap;
  }) => {
    const id = payload.id;
    const url = id ? `/api/proxies/${id}` : '/api/proxies';
    const method = id ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save proxy configuration');
      }

      setIsModalOpen(false);
      await fetchConfig();
    } catch (err: any) {
      alert(`保存代理失败: ${err.message}`);
    }
  };

  // Fetch initial logs and set up EventSource stream
  useEffect(() => {
    // 1. Fetch initial logs
    fetch('/api/logs')
      .then(res => res.json())
      .then((initialLogs: LogItem[]) => {
        setLogs(initialLogs || []);
      })
      .catch(err => {
        console.error('Failed to load initial logs:', err);
      });

    // 2. Open EventSource for live logs stream
    const source = new EventSource('/api/logs/stream');
    
    source.onmessage = (event) => {
      try {
        const logItem: LogItem = JSON.parse(event.data);
        setLogs(prev => [logItem, ...prev].slice(0, 200)); // keep max 200 logs
      } catch (err) {
        console.error('Failed to parse incoming log SSE:', err);
      }
    };

    source.onerror = (err) => {
      console.error('SSE Error:', err);
      source.close();
    };

    fetchConfig();

    return () => {
      source.close();
    };
  }, []);

  const total = proxies.length;
  const running = proxies.filter(p => p.running).length;
  const stopped = total - running;

  return (
    <div className="app-container">
      {/* Header */}
      <Header dashboardPort={dashboardPort} />

      {/* Navigation Tabs */}
      <nav className="nav-tabs">
        <button
          className={`tab-btn ${activeTab === 'proxies' ? 'active' : ''}`}
          onClick={() => setActiveTab('proxies')}
        >
          代理管理
        </button>
        <button
          className={`tab-btn ${activeTab === 'playground' ? 'active' : ''}`}
          onClick={() => setActiveTab('playground')}
        >
          测试沙盒 (Playground)
        </button>
        <button
          className={`tab-btn ${activeTab === 'logs' ? 'active' : ''}`}
          onClick={() => setActiveTab('logs')}
        >
          实时控制台日志
        </button>
      </nav>

      {/* Main Content Pane */}
      <main className="main-content">
        
        {/* Proxies Manager View */}
        {activeTab === 'proxies' && (
          <section id="tab-proxies" className="tab-pane active">
            <div className="pane-header">
              <h2>活跃的代理实例</h2>
              <button className="btn btn-primary" onClick={handleOpenAddModal}>
                + 新建代理实例
              </button>
            </div>
            
            <Stats total={total} running={running} stopped={stopped} />

            <div className="proxies-grid">
              {proxies.length === 0 ? (
                <div className="empty-state">
                  <h3>暂无代理实例</h3>
                  <p>点击上方“新建代理实例”按钮来创建一个端口转发网关吧。</p>
                </div>
              ) : (
                proxies.map(proxy => (
                  <ProxyCard
                    key={proxy.id}
                    proxy={proxy}
                    onToggle={handleToggleProxy}
                    onEdit={handleOpenEditModal}
                    onDelete={handleDeleteProxy}
                  />
                ))
              )}
            </div>
          </section>
        )}

        {/* Playground Sandbox View */}
        {activeTab === 'playground' && (
          <section id="tab-playground" className="tab-pane active">
            <Playground />
          </section>
        )}

        {/* Console Logs View */}
        {activeTab === 'logs' && (
          <section id="tab-logs" className="tab-pane active">
            <LogsConsole logs={logs} onClear={() => setLogs([])} />
          </section>
        )}
      </main>

      {/* Edit/Add Modal Overlay */}
      <ProxyModal
        isOpen={isModalOpen}
        proxy={editingProxy}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSaveProxy}
      />
    </div>
  );
}

export default App;
