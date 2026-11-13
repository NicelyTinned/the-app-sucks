import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertCircle, ArrowDown, ArrowUpRight, Bot, Check, CheckCircle2, ChevronDown, ChevronsUpDown,
  Code2, Command, Copy, Download, FileCode2, FilePlus2, Folder, KeyRound, LoaderCircle,
  LogOut, Menu, MessageSquare, Moon, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Play,
  Plus, Puzzle, Save, Search, Send, Settings2, ShieldCheck, Sparkles, TerminalSquare,
  Trash2, Upload, UserRound, X, Zap
} from "lucide-react";
import { api, ApiError } from "./api";
import { PROVIDERS } from "./providers";
import type { ApiKeyMeta, AppSettings, Chat, Message, PluginMeta, ProviderMeta, WorkspaceFile } from "./types";

const DEFAULT_SETTINGS: AppSettings = {
  personality: "Clear, thoughtful, curious, and practical. Be honest about uncertainty.",
  sharedMemory: "",
  memoryEnabled: false,
  temperature: 0.7,
  topP: 0.95,
  maxTokens: 4096,
  defaultProvider: "openai",
  defaultModel: ""
};

const PLUGIN_STARTER = `name: hello-world
version: 1
description: A tiny example plugin that reads a public JSON endpoint.
hosts:
  - api.github.com
secrets: []
tools:
  - name: get_repo
    description: Get public metadata for a GitHub repository.
    method: GET
    url: https://api.github.com/repos/${"${input.owner}"}/${"${input.repo}"}
    headers:
      Accept: application/vnd.github+json
      User-Agent: the-app-sucks
    input_schema:
      type: object
      properties:
        owner:
          type: string
          description: Repository owner or organization
        repo:
          type: string
          description: Repository name
      required: [owner, repo]
`;

const QUICK_PROMPTS = [
  { icon: "✳", title: "Explain something clearly", prompt: "Explain a complex topic in plain language, with a useful example." },
  { icon: "⌘", title: "Build a small project", prompt: "Help me plan and build a small web project. Start with a practical outline." },
  { icon: "↗", title: "Compare different ideas", prompt: "Compare a few approaches to solving this problem and explain the trade-offs." },
  { icon: "∴", title: "Think through a problem", prompt: "Help me reason through a problem step by step. Ask only for details you truly need." }
];

function formatDate(timestamp?: number) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function initials(email: string) {
  return email.split("@")[0].slice(0, 2).toUpperCase();
}

function providerLabel(id: string, providers: ProviderMeta[]) {
  return providers.find((provider) => provider.id === id)?.label || PROVIDERS.find((provider) => provider.id === id)?.label || id;
}

function useToast() {
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" | "info" } | null>(null);
  const showToast = (message: string, tone: "success" | "error" | "info" = "info") => {
    setToast({ message, tone });
    window.setTimeout(() => setToast(null), 3200);
  };
  return { toast, showToast };
}

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand-lockup ${compact ? "compact" : ""}`}>
      <div className="brand-mark"><Sparkles size={17} strokeWidth={2.4} /></div>
      {!compact && <div className="brand-name">the app <span>sucks</span><small>YOUR MODELS. YOUR RULES.</small></div>}
    </div>
  );
}

function AuthScreen({ onAuthed }: { onAuthed: () => void }) {
  const [mode, setMode] = useState<"login" | "register">("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await api(`/api/auth/${mode}`, { method: "POST", body: JSON.stringify({ email, password }) });
      onAuthed();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-glow glow-a" /><div className="auth-glow glow-b" />
      <div className="auth-top"><Logo /><span className="tiny-status"><span /> PRIVATE WORKSPACE</span></div>
      <motion.div className="auth-card" initial={{ opacity: 0, y: 18, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: .45, ease: "easeOut" }}>
        <div className="eyebrow"><span className="eyebrow-dot" /> ONE WORKSPACE, MANY BRAINS</div>
        <h1>your chat.<br /><em>your stack.</em></h1>
        <p className="auth-subtitle">Bring the models you already use. Keep your chats, keys, tools, and little experiments in one place.</p>
        <div className="auth-switch">
          <button className={mode === "register" ? "selected" : ""} onClick={() => setMode("register")}>Create account</button>
          <button className={mode === "login" ? "selected" : ""} onClick={() => setMode("login")}>Sign in</button>
        </div>
        <form onSubmit={submit} className="auth-form">
          <label>Email address</label>
          <input autoComplete="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required />
          <label>Password</label>
          <input autoComplete={mode === "register" ? "new-password" : "current-password"} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 10 characters" minLength={10} required />
          {error && <div className="inline-error"><AlertCircle size={15} /> {error}</div>}
          <button className="primary-button auth-submit" disabled={loading} type="submit">{loading ? <LoaderCircle className="spin" size={17} /> : <span>{mode === "register" ? "Create workspace" : "Open workspace"}</span>} <ArrowUpRight size={17} /></button>
        </form>
        <div className="auth-foot"><ShieldCheck size={14} /> Your API keys are encrypted and never sent to the browser after saving.</div>
      </motion.div>
      <div className="auth-bottom"><span>BUILD YOUR OWN AI WORKSPACE</span><span>NO SERVER TO MAINTAIN. JUST CLOUDFLARE.</span></div>
    </div>
  );
}

function SettingsModal({
  settings, initialTab = "models", onSaveSettings, keys, onAddKey, onDeleteKey, plugins, onRefresh, onClose, showToast, providers
}: {
  settings: AppSettings;
  initialTab?: "models" | "behavior" | "memory" | "plugins";
  onSaveSettings: (settings: AppSettings) => Promise<void>;
  keys: ApiKeyMeta[];
  onAddKey: (provider: string, model: string, secret: string, label: string) => Promise<void>;
  onDeleteKey: (id: string) => Promise<void>;
  plugins: PluginMeta[];
  onRefresh: () => Promise<void>;
  onClose: () => void;
  showToast: (message: string, tone?: "success" | "error" | "info") => void;
  providers: ProviderMeta[];
}) {
  const [tab, setTab] = useState<"models" | "behavior" | "memory" | "plugins">(initialTab);
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [keyProvider, setKeyProvider] = useState("openai");
  const [keyModel, setKeyModel] = useState("");
  const [keyLabel, setKeyLabel] = useState("");
  const [keySecret, setKeySecret] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [yaml, setYaml] = useState(PLUGIN_STARTER);
  const [editingPlugin, setEditingPlugin] = useState<string | null>(null);
  const [pluginValidation, setPluginValidation] = useState<any>(null);
  const [pluginError, setPluginError] = useState("");
  const [pluginSaving, setPluginSaving] = useState(false);
  const [secretValues, setSecretValues] = useState<Record<string, string>>({});
  const [secretNames, setSecretNames] = useState<Record<string, string[]>>({});

  useEffect(() => { setDraft(settings); }, [settings]);
  useEffect(() => {
    let alive = true;
    async function inspectPlugins() {
      const found: Record<string, string[]> = {};
      for (const plugin of plugins) {
        try {
          const result = await api<{ manifest: { secrets?: string[] } }>("/api/plugins/validate", { method: "POST", body: JSON.stringify({ yaml: plugin.yamlSource }) });
          found[plugin.id] = result.manifest.secrets || [];
        } catch { found[plugin.id] = []; }
      }
      if (alive) setSecretNames(found);
    }
    inspectPlugins();
    return () => { alive = false; };
  }, [plugins]);

  const selectedProviderLabel = (id: string) => providerLabel(id, providers);

  async function saveDraft() {
    setSavingSettings(true);
    try {
      await onSaveSettings(draft);
      showToast("Settings saved.", "success");
    } catch (error) { showToast(error instanceof Error ? error.message : "Could not save settings.", "error"); }
    finally { setSavingSettings(false); }
  }

  async function addKey(event: FormEvent) {
    event.preventDefault();
    setSavingKey(true);
    try {
      await onAddKey(keyProvider, keyModel, keySecret, keyLabel);
      setKeySecret(""); setKeyLabel("");
      showToast("API key encrypted and saved.", "success");
    } catch (error) { showToast(error instanceof Error ? error.message : "Could not save API key.", "error"); }
    finally { setSavingKey(false); }
  }

  async function validatePlugin() {
    setPluginError(""); setPluginValidation(null);
    try {
      const result = await api<{ valid: boolean; manifest: any }>("/api/plugins/validate", { method: "POST", body: JSON.stringify({ yaml }) });
      setPluginValidation(result.manifest);
      showToast(`Plugin valid: ${result.manifest.name}`, "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Plugin validation failed.";
      setPluginError(message); showToast(message, "error");
    }
  }

  async function savePlugin() {
    setPluginSaving(true); setPluginError("");
    try {
      await api("/api/plugins", { method: "POST", body: JSON.stringify({ yaml }) });
      await onRefresh();
      setEditingPlugin(null); setPluginValidation(null);
      showToast("Plugin saved. Turn it on when you're ready.", "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Plugin could not be saved.";
      setPluginError(message); showToast(message, "error");
    } finally { setPluginSaving(false); }
  }

  async function togglePlugin(plugin: PluginMeta) {
    try {
      await api(`/api/plugins/${plugin.id}/toggle`, { method: "PUT", body: JSON.stringify({ enabled: !plugin.enabled }) });
      await onRefresh();
    } catch (error) { showToast(error instanceof Error ? error.message : "Could not update plugin.", "error"); }
  }

  async function removePlugin(plugin: PluginMeta) {
    if (!window.confirm(`Delete plugin "${plugin.name}" and its stored secrets?`)) return;
    try { await api(`/api/plugins/${plugin.id}`, { method: "DELETE" }); await onRefresh(); showToast("Plugin removed.", "success"); }
    catch (error) { showToast(error instanceof Error ? error.message : "Could not delete plugin.", "error"); }
  }

  async function saveSecret(pluginId: string, name: string) {
    const value = secretValues[`${pluginId}:${name}`] || "";
    if (!value) return;
    try {
      await api(`/api/plugins/${pluginId}/secrets`, { method: "PUT", body: JSON.stringify({ name, value }) });
      setSecretValues((current) => ({ ...current, [`${pluginId}:${name}`]: "" }));
      showToast(`${name} encrypted and saved.`, "success");
    } catch (error) { showToast(error instanceof Error ? error.message : "Could not save plugin secret.", "error"); }
  }

  function downloadPlugin(plugin: PluginMeta) {
    const blob = new Blob([plugin.yamlSource], { type: "text/yaml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${plugin.name}.yaml`; anchor.click(); URL.revokeObjectURL(url);
  }

  async function importFile(file?: File) {
    if (!file) return;
    if (file.size > 30_000) { setPluginError("Plugin files must be under 30 KB."); return; }
    setYaml(await file.text()); setEditingPlugin(null); setPluginValidation(null); setTab("plugins");
  }

  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <motion.div className="settings-modal" initial={{ y: 22, opacity: 0, scale: .985 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 16, opacity: 0 }} transition={{ duration: .22 }}>
        <div className="modal-header"><div><span className="eyebrow">WORKSPACE CONTROL ROOM</span><h2>settings <span>&</span> controls</h2></div><button className="icon-button" onClick={onClose} aria-label="Close settings"><X size={19} /></button></div>
        <div className="settings-body">
          <nav className="settings-nav">
            <button className={tab === "models" ? "active" : ""} onClick={() => setTab("models")}><KeyRound size={16} /> Models & keys</button>
            <button className={tab === "behavior" ? "active" : ""} onClick={() => setTab("behavior")}><SlidersIcon /> Behavior</button>
            <button className={tab === "memory" ? "active" : ""} onClick={() => setTab("memory")}><BrainIcon /> Shared memory</button>
            <button className={tab === "plugins" ? "active" : ""} onClick={() => setTab("plugins")}><Puzzle size={16} /> Plugins <span className="nav-count">{plugins.length}</span></button>
          </nav>
          <div className="settings-content">
            {tab === "models" && <section className="settings-section">
              <div className="section-heading"><div><h3>API key vault</h3><p>Keys are encrypted at rest. They only leave the Worker to call their own provider.</p></div><span className="mini-pill"><ShieldCheck size={12} /> SERVER SIDE</span></div>
              <form onSubmit={addKey} className="key-form">
                <div className="field-grid">
                  <div className="field"><label>Provider</label><select value={keyProvider} onChange={(event) => setKeyProvider(event.target.value)}>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}</select></div>
                  <div className="field"><label>Model scope <span>optional</span></label><input value={keyModel} onChange={(event) => setKeyModel(event.target.value)} placeholder="blank = any model at this provider" /></div>
                </div>
                <div className="field"><label>Key label <span>optional</span></label><input value={keyLabel} onChange={(event) => setKeyLabel(event.target.value)} placeholder="e.g. personal key 01" /></div>
                <div className="field"><label>API key</label><input value={keySecret} onChange={(event) => setKeySecret(event.target.value)} type="password" autoComplete="off" placeholder="paste provider API key" required /></div>
                <button className="primary-button" type="submit" disabled={savingKey || !keySecret}>{savingKey ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />} Add encrypted key</button>
              </form>
              <div className="key-list-heading"><h4>Saved keys <span>{keys.length}</span></h4><p>Keys rotate round-robin per provider and model request.</p></div>
              <div className="saved-key-list">
                {keys.length === 0 ? <div className="empty-small"><KeyRound size={18} /><span>No keys yet. Add one above to connect a model.</span></div> : keys.map((key) => <div className="saved-key" key={key.id}>
                  <div className="key-glyph"><KeyRound size={16} /></div>
                  <div className="saved-key-info"><strong>{key.label || selectedProviderLabel(key.provider)}</strong><span>{selectedProviderLabel(key.provider)}{key.model ? ` · ${key.model}` : " · all models"} · •••• {key.lastFour}</span></div>
                  <button className="icon-button danger-hover" onClick={() => onDeleteKey(key.id)} title="Delete key"><Trash2 size={15} /></button>
                </div>)}
              </div>
              <div className="provider-wall"><span>PROVIDER ADAPTERS</span><div>{providers.map((provider) => <span key={provider.id}>{provider.label}</span>)}</div></div>
            </section>}

            {tab === "behavior" && <section className="settings-section">
              <div className="section-heading"><div><h3>Model behavior</h3><p>Defaults for new chats. Individual chats can keep their own model and provider.</p></div></div>
              <div className="field"><label>AI personality / system guidance</label><textarea className="personality-area" value={draft.personality} onChange={(event) => setDraft({ ...draft, personality: event.target.value })} placeholder="Describe how your assistant should behave..." /></div>
              <div className="range-setting"><div><label>Temperature</label><span>More focused ←→ more varied</span></div><strong>{draft.temperature.toFixed(2)}</strong><input type="range" min="0" max="2" step="0.05" value={draft.temperature} onChange={(event) => setDraft({ ...draft, temperature: Number(event.target.value) })} /></div>
              <div className="range-setting"><div><label>Top P</label><span>Sampling diversity</span></div><strong>{draft.topP.toFixed(2)}</strong><input type="range" min="0" max="1" step="0.01" value={draft.topP} onChange={(event) => setDraft({ ...draft, topP: Number(event.target.value) })} /></div>
              <div className="field max-token-field"><label>Maximum output tokens</label><input type="number" min={128} max={32000} step={128} value={draft.maxTokens} onChange={(event) => setDraft({ ...draft, maxTokens: Math.max(128, Math.min(32000, Number(event.target.value) || 128)) })} /></div>
              <div className="settings-note"><Zap size={15} /><span>Some providers or models ignore certain sampling parameters. The provider decides what it accepts.</span></div>
              <button className="primary-button" onClick={saveDraft} disabled={savingSettings}>{savingSettings ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />} Save behavior</button>
            </section>}

            {tab === "memory" && <section className="settings-section">
              <div className="section-heading"><div><h3>Shared memory</h3><p>One editable note shared with every chat on this account.</p></div></div>
              <div className="memory-toggle-row"><div className="memory-icon"><BrainIcon /></div><div><strong>Use shared memory</strong><span>Include these notes in the assistant's system context.</span></div><button className={`toggle ${draft.memoryEnabled ? "on" : ""}`} onClick={() => setDraft({ ...draft, memoryEnabled: !draft.memoryEnabled })} aria-label="Toggle shared memory"><span /></button></div>
              <div className="field"><label>Memory notes</label><textarea className="memory-area" value={draft.sharedMemory} onChange={(event) => setDraft({ ...draft, sharedMemory: event.target.value })} placeholder="Add preferences, ongoing project context, or details you want all chats to know..." /></div>
              <div className="settings-note"><ShieldCheck size={15} /><span>Memory is off by default. Nothing is silently inferred or saved here; you control this text.</span></div>
              <button className="primary-button" onClick={saveDraft} disabled={savingSettings}>{savingSettings ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />} Save memory settings</button>
            </section>}

            {tab === "plugins" && <section className="settings-section plugin-settings">
              <div className="section-heading"><div><h3>Plugin workshop</h3><p>Build small HTTP tools using the App Sucks YAML DSL. No plugin code execution.</p></div><span className="mini-pill"><Puzzle size={12} /> YAML DSL v1</span></div>
              <div className="plugin-editor-card">
                <div className="plugin-editor-top"><div><strong>{editingPlugin ? "Edit plugin source" : "Create a plugin"}</strong><span>Save as a .yaml file, then import it anywhere.</span></div><label className="secondary-button upload-label"><Upload size={14} /> Import YAML<input type="file" accept=".yaml,.yml,text/yaml,text/plain" onChange={(event) => importFile(event.target.files?.[0])} /></label></div>
                <textarea className="yaml-editor" spellCheck={false} value={yaml} onChange={(event) => { setYaml(event.target.value); setPluginValidation(null); }} />
                <div className="plugin-editor-actions"><div>{pluginValidation ? <span className="validation-good"><CheckCircle2 size={14} /> Valid: {pluginValidation.tools.length} tool(s)</span> : pluginError ? <span className="validation-bad"><AlertCircle size={14} /> {pluginError}</span> : <span className="muted">Use HTTPS URLs and declare every host.</span>}</div><div><button className="secondary-button" onClick={validatePlugin}>Validate</button><button className="primary-button small-primary" onClick={savePlugin} disabled={pluginSaving}>{pluginSaving ? <LoaderCircle className="spin" size={14} /> : <Save size={14} />} Save plugin</button></div></div>
              </div>
              <div className="installed-plugins-heading"><h4>Installed plugins <span>{plugins.length}</span></h4><p>Enabled plugins can be called by the assistant.</p></div>
              {plugins.length === 0 ? <div className="empty-small"><Puzzle size={18} /><span>No plugins installed. Validate and save the example above to try it.</span></div> : <div className="installed-plugin-list">{plugins.map((plugin) => <div className="installed-plugin" key={plugin.id}>
                <div className="plugin-icon"><Puzzle size={17} /></div><div className="installed-plugin-main"><div><strong>{plugin.name}</strong><span className={plugin.enabled ? "enabled-label" : "disabled-label"}>{plugin.enabled ? "ENABLED" : "DISABLED"}</span></div><p>{plugin.description}</p>
                  {(secretNames[plugin.id] || []).map((name) => <div className="plugin-secret-row" key={name}><label>{name}</label><input type="password" autoComplete="off" value={secretValues[`${plugin.id}:${name}`] || ""} onChange={(event) => setSecretValues((current) => ({ ...current, [`${plugin.id}:${name}`]: event.target.value }))} placeholder="Set or rotate secret" /><button className="secondary-button" onClick={() => saveSecret(plugin.id, name)}>Save secret</button></div>)}
                </div>
                <div className="plugin-actions"><button className={`toggle ${plugin.enabled ? "on" : ""}`} onClick={() => togglePlugin(plugin)} aria-label="Toggle plugin"><span /></button><button className="icon-button" title="Edit YAML" onClick={() => { setYaml(plugin.yamlSource); setEditingPlugin(plugin.id); setPluginValidation(null); }}><Code2 size={15} /></button><button className="icon-button" title="Download YAML" onClick={() => downloadPlugin(plugin)}><Download size={15} /></button><button className="icon-button danger-hover" title="Delete plugin" onClick={() => removePlugin(plugin)}><Trash2 size={15} /></button></div>
              </div>)}</div>}
              <div className="settings-note"><ShieldCheck size={15} /><span>Plugin requests require HTTPS, exact host allowlisting, validated inputs, blocked redirects, and a 15-second timeout. Do not add private or untrusted endpoints.</span></div>
            </section>}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function SlidersIcon() { return <Settings2 size={16} />; }
function BrainIcon() { return <Sparkles size={16} />; }

function buildSandboxDocument(code: string) {
  const literal = JSON.stringify(code).replaceAll("<", "\\u003c");
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; worker-src blob:; style-src 'unsafe-inline'; connect-src 'none'; img-src data:; font-src 'none';"><style>body{margin:0;background:#0c1019;color:#d7e0ef;font:12px ui-monospace,monospace;padding:12px}pre{white-space:pre-wrap;word-break:break-word;margin:0}.muted{color:#758198}</style></head><body><pre id="out" class="muted">Run output will appear here.</pre><script>const source=${literal};const out=document.getElementById('out');const workerSource = \`self.onmessage=async(e)=>{const code=e.data;const lines=[];const safeConsole={log:(...a)=>lines.push(a.map(String).join(' ')),info:(...a)=>lines.push(a.map(String).join(' ')),warn:(...a)=>lines.push('[warn] '+a.map(String).join(' ')),error:(...a)=>lines.push('[error] '+a.map(String).join(' ')),table:(a)=>lines.push(JSON.stringify(a,null,2))};try{const fn=new Function('console','fetch','XMLHttpRequest','WebSocket','EventSource','importScripts','indexedDB','caches',code);const result=fn(safeConsole,()=>Promise.reject(new Error('Network is disabled in this workspace')),undefined,undefined,undefined,undefined,undefined,undefined);const value=await result;if(value!==undefined)lines.push(String(value));self.postMessage({lines});}catch(error){self.postMessage({error:error&&error.message?error.message:String(error),lines});}};\`;const workerUrl=URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'}));const worker=new Worker(workerUrl);let finished=false;const timer=setTimeout(()=>{if(!finished){worker.terminate();URL.revokeObjectURL(workerUrl);out.className='';out.textContent='Stopped: execution exceeded the 2-second sandbox limit.';}},2000);worker.onmessage=(event)=>{finished=true;clearTimeout(timer);worker.terminate();URL.revokeObjectURL(workerUrl);out.className='';out.textContent=event.data.error?'Error: '+event.data.error:(event.data.lines.join('\\n')||'Finished with no output.');};worker.onerror=(event)=>{finished=true;clearTimeout(timer);worker.terminate();URL.revokeObjectURL(workerUrl);out.className='';out.textContent='Sandbox error: '+event.message;};worker.postMessage(source);</script></body></html>`;
}

function WorkspacePanel({ chatId, onClose, showToast }: { chatId: string; onClose: () => void; showToast: (message: string, tone?: "success" | "error" | "info") => void }) {
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [content, setContent] = useState("");
  const [path, setPath] = useState("index.js");
  const [newPath, setNewPath] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [runDocument, setRunDocument] = useState("");

  async function refresh() {
    const result = await api<{ files: WorkspaceFile[] }>(`/api/chats/${chatId}/files`);
    setFiles(result.files);
    if (result.files.length && !result.files.some((file) => file.id === selectedId)) {
      setSelectedId(result.files[0].id); setPath(result.files[0].path); setContent(result.files[0].content);
    }
  }
  useEffect(() => {
    let active = true;
    api<{ files: WorkspaceFile[] }>(`/api/chats/${chatId}/files`).then((result) => {
      if (!active) return;
      setFiles(result.files);
      if (result.files.length) { setSelectedId(result.files[0].id); setPath(result.files[0].path); setContent(result.files[0].content); }
      else { setPath("index.js"); setContent("// this file belongs only to this chat\n\nconsole.log('hello from the isolated workspace');\n"); }
    }).catch((error) => showToast(error.message, "error")).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [chatId]);

  function selectFile(file: WorkspaceFile) { setSelectedId(file.id); setPath(file.path); setContent(file.content); setRunDocument(""); }
  async function saveFile() {
    setSaving(true);
    try {
      const result = await api<{ file: WorkspaceFile }>(`/api/chats/${chatId}/files`, { method: "PUT", body: JSON.stringify({ path, content }) });
      setSelectedId(result.file.id); await refresh(); showToast("Workspace file saved.", "success");
    } catch (error) { showToast(error instanceof Error ? error.message : "Could not save file.", "error"); }
    finally { setSaving(false); }
  }
  async function createFile() {
    const clean = newPath.trim(); if (!clean) return;
    try {
      const result = await api<{ file: WorkspaceFile }>(`/api/chats/${chatId}/files`, { method: "PUT", body: JSON.stringify({ path: clean, content: "" }) });
      await refresh(); setSelectedId(result.file.id); setPath(result.file.path); setContent(""); setNewPath(""); showToast("File created.", "success");
    } catch (error) { showToast(error instanceof Error ? error.message : "Could not create file.", "error"); }
  }
  async function deleteFile() {
    if (!selectedId || !window.confirm(`Delete ${path}?`)) return;
    try { await api(`/api/files/${selectedId}`, { method: "DELETE" }); setSelectedId(""); setPath("index.js"); setContent(""); setRunDocument(""); await refresh(); }
    catch (error) { showToast(error instanceof Error ? error.message : "Could not delete file.", "error"); }
  }

  return (
    <motion.div className="modal-backdrop workspace-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="workspace-modal" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}>
        <div className="workspace-header"><div className="workspace-heading"><div className="workspace-icon"><TerminalSquare size={18} /></div><div><h2>chat workspace</h2><p>Files are stored separately for this conversation.</p></div></div><div className="workspace-head-actions"><span className="sandbox-tag"><ShieldCheck size={12} /> BROWSER SANDBOX</span><button className="icon-button" onClick={onClose}><X size={19} /></button></div></div>
        <div className="workspace-layout">
          <aside className="file-rail"><div className="rail-label">FILES <span>{files.length}/30</span></div>{files.map((file) => <button key={file.id} className={`file-item ${selectedId === file.id ? "active" : ""}`} onClick={() => selectFile(file)}><FileCode2 size={14} />{file.path}</button>)}
            <div className="new-file-box"><input value={newPath} onChange={(event) => setNewPath(event.target.value)} placeholder="new-file.js" onKeyDown={(event) => { if (event.key === "Enter") createFile(); }} /><button onClick={createFile} title="Create file"><Plus size={15} /></button></div>
            <div className="workspace-limits">30 files · 500 KB total<br />No server shell or filesystem access.</div>
          </aside>
          <section className="editor-side"><div className="editor-toolbar"><div className="editor-file-name"><span className="file-dot" />{path}</div><div className="editor-actions"><button className="secondary-button" onClick={saveFile} disabled={saving}>{saving ? <LoaderCircle size={14} className="spin" /> : <Save size={14} />} Save</button><button className="primary-button small-primary" onClick={() => setRunDocument(buildSandboxDocument(content))}><Play size={14} /> Run JS</button><button className="icon-button danger-hover" onClick={deleteFile} title="Delete current file"><Trash2 size={15} /></button></div></div>
            <textarea className="code-editor" value={content} onChange={(event) => setContent(event.target.value)} spellCheck={false} placeholder="// write JavaScript here" />
            <div className="runner-panel"><div className="runner-header"><span><span className="runner-dot" /> OUTPUT / PREVIEW</span><span>network disabled · isolated iframe</span></div>{runDocument ? <iframe className="runner-frame" title="Sandboxed JavaScript output" sandbox="allow-scripts" srcDoc={runDocument} /> : <div className="runner-empty">Press <kbd>Run JS</kbd> to execute this file in an isolated browser frame.</div>}</div>
          </section>
        </div>
      </motion.div>
    </motion.div>
  );
}

function MessageContent({ content }: { content: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    a: ({ ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
    code: ({ node: _node, className, children, ...props }) => <code className={className} {...props}>{children}</code>,
    pre: ({ children }) => <pre className="markdown-pre">{children}</pre>
  }}>{content}</ReactMarkdown>;
}

function ChatMessage({ message }: { message: Message }) {
  if (message.role === "tool") return <div className="tool-event"><div className="tool-event-icon"><Zap size={13} /></div><span>{message.content.slice(0, 210)}</span><span className="tool-event-label">TOOL OUTPUT</span></div>;
  const user = message.role === "user";
  return (
    <motion.article className={`message-row ${user ? "user-message" : "assistant-message"}`} initial={{ opacity: 0, y: 9 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .22 }}>
      <div className={`message-avatar ${user ? "user-avatar" : "assistant-avatar"}`}>{user ? <UserRound size={15} /> : <Sparkles size={15} />}</div>
      <div className="message-main"><div className="message-meta"><strong>{user ? "you" : "assistant"}</strong>{message.createdAt && <span>{formatDate(message.createdAt)}</span>}</div><div className="message-content"><MessageContent content={message.content} /></div></div>
    </motion.article>
  );
}

function App() {
  const [booting, setBooting] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [user, setUser] = useState<{ id: string; email: string } | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [chats, setChats] = useState<Chat[]>([]);
  const [keys, setKeys] = useState<ApiKeyMeta[]>([]);
  const [plugins, setPlugins] = useState<PluginMeta[]>([]);
  const [providers, setProviders] = useState<ProviderMeta[]>(PROVIDERS.map(({ id, label, family }) => ({ id, label, family })));
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [modelInput, setModelInput] = useState("");
  const [selectedProvider, setSelectedProvider] = useState("openai");
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"models" | "behavior" | "memory" | "plugins">("models");
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [toast, showToast] = useToast();
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activeChat = chats.find((chat) => chat.id === activeChatId) || null;

  async function refreshState() {
    const result = await api<any>("/api/state");
    setUser(result.user); setSettings({ ...DEFAULT_SETTINGS, ...result.settings });
    setChats(result.chats || []); setKeys(result.keys || []); setPlugins(result.plugins || []); setProviders(result.providers || []);
    setSelectedProvider(result.settings?.defaultProvider || "openai"); setModelInput(result.settings?.defaultModel || "");
  }

  useEffect(() => {
    let active = true;
    api<any>("/api/state").then((result) => {
      if (!active) return;
      setUser(result.user); setSettings({ ...DEFAULT_SETTINGS, ...result.settings });
      setChats(result.chats || []); setKeys(result.keys || []); setPlugins(result.plugins || []); setProviders(result.providers || []);
      setSelectedProvider(result.settings?.defaultProvider || "openai"); setModelInput(result.settings?.defaultModel || ""); setAuthed(true);
    }).catch(() => { if (active) setAuthed(false); }).finally(() => { if (active) setBooting(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!activeChatId) { setMessages([]); return; }
    let active = true;
    api<{ chat: any; messages: Message[] }>(`/api/chats/${activeChatId}`).then((result) => {
      if (!active) return;
      setMessages(result.messages || []);
      setSelectedProvider(result.chat.provider || "openai");
      setModelInput(result.chat.model || "");
    }).catch((error) => { if (active) showToast(error.message, "error"); });
    return () => { active = false; };
  }, [activeChatId]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  async function afterAuth() {
    await refreshState(); setAuthed(true);
  }

  async function createChat() {
    try {
      const result = await api<{ chat: Chat }>("/api/chats", { method: "POST", body: JSON.stringify({ provider: selectedProvider, model: modelInput }) });
      setChats((current) => [result.chat, ...current]); setActiveChatId(result.chat.id); setMessages([]); setDraft(""); setSidebarOpen(false);
      return result.chat.id;
    } catch (error) { showToast(error instanceof Error ? error.message : "Could not create chat.", "error"); return null; }
  }

  async function chooseChat(id: string) { setActiveChatId(id); setSidebarOpen(false); setDraft(""); }

  async function updateCurrentModel(provider = selectedProvider, model = modelInput) {
    setSelectedProvider(provider); setModelInput(model);
    if (activeChatId) {
      setChats((current) => current.map((chat) => chat.id === activeChatId ? { ...chat, provider: provider as any, model } : chat));
      try { await api(`/api/chats/${activeChatId}/config`, { method: "PUT", body: JSON.stringify({ provider, model }) }); }
      catch (error) { showToast(error instanceof Error ? error.message : "Could not update the chat model.", "error"); }
    } else {
      const next = { ...settings, defaultProvider: provider as any, defaultModel: model };
      setSettings(next);
      try { await api("/api/settings", { method: "PUT", body: JSON.stringify({ settings: next }) }); }
      catch (error) { showToast(error instanceof Error ? error.message : "Could not save model defaults.", "error"); }
    }
  }

  async function sendMessage(text = draft) {
    const content = text.trim();
    if (!content || busy) return;
    let chatId = activeChatId;
    if (!chatId) chatId = await createChat();
    if (!chatId) return;
    setDraft(""); setBusy(true);
    const optimistic: Message = { id: `temp-${Date.now()}`, role: "user", content, createdAt: Date.now() };
    setMessages((current) => [...current, optimistic]);
    try {
      const result = await api<{ assistant: Message; title?: string; toolCalls: number }>(`/api/chats/${chatId}/messages`, {
        method: "POST",
        body: JSON.stringify({ content, provider: selectedProvider, model: modelInput })
      });
      setMessages((current) => {
        const lastUser = [...current].reverse().find((item) => item.role === "user");
        return lastUser?.content === content ? [...current, result.assistant] : [...current, optimistic, result.assistant];
      });
      setChats((current) => current.map((chat) => chat.id === chatId ? { ...chat, title: result.title || chat.title, updatedAt: Date.now() } : chat).sort((a, b) => b.updatedAt - a.updatedAt));
      if (result.toolCalls) showToast(`Assistant used ${result.toolCalls} plugin tool call(s).`, "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "The model request failed.";
      setMessages((current) => [...current, { id: `error-${Date.now()}`, role: "assistant", content: `**Request failed**\n\n${message}`, createdAt: Date.now() }]);
      showToast(message, "error");
    } finally { setBusy(false); textareaRef.current?.focus(); }
  }

  async function saveSettings(next: AppSettings) {
    await api("/api/settings", { method: "PUT", body: JSON.stringify({ settings: next }) });
    setSettings(next);
  }

  async function addKey(provider: string, model: string, secret: string, label: string) {
    await api("/api/keys", { method: "POST", body: JSON.stringify({ provider, model, secret, label }) });
    const result = await api<any>("/api/state"); setKeys(result.keys || []);
  }

  async function deleteKey(id: string) {
    if (!window.confirm("Delete this saved API key?")) return;
    try { await api(`/api/keys/${id}`, { method: "DELETE" }); setKeys((current) => current.filter((key) => key.id !== id)); showToast("API key deleted.", "success"); }
    catch (error) { showToast(error instanceof Error ? error.message : "Could not delete key.", "error"); }
  }

  async function deleteChat(chat: Chat) {
    if (!window.confirm(`Delete "${chat.title}" and its messages and files?`)) return;
    try {
      await api(`/api/chats/${chat.id}`, { method: "DELETE" });
      setChats((current) => current.filter((item) => item.id !== chat.id));
      if (activeChatId === chat.id) { setActiveChatId(null); setMessages([]); }
      showToast("Chat deleted.", "success");
    } catch (error) { showToast(error instanceof Error ? error.message : "Could not delete chat.", "error"); }
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST", body: JSON.stringify({}) }).catch(() => undefined);
    setAuthed(false); setUser(null); setActiveChatId(null); setMessages([]); setChats([]);
  }

  function handleComposerKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendMessage(); }
  }

  const filteredChats = useMemo(() => chats.filter((chat) => chat.title.toLowerCase().includes(searchTerm.toLowerCase())), [chats, searchTerm]);

  if (booting) return <div className="boot-screen"><Logo /><div className="boot-loader"><span /><span /><span /></div></div>;
  if (!authed) return <AuthScreen onAuthed={afterAuth} />;

  return (
    <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <AnimatePresence>{sidebarOpen && <motion.div className="mobile-sidebar-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSidebarOpen(false)} />}</AnimatePresence>
      <aside className={`sidebar ${sidebarOpen ? "mobile-open" : ""}`}>
        <div className="sidebar-top"><Logo compact={sidebarCollapsed} /><button className="icon-button collapse-button" onClick={() => setSidebarCollapsed(!sidebarCollapsed)} title="Collapse sidebar">{sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}</button><button className="icon-button mobile-close" onClick={() => setSidebarOpen(false)}><X size={18} /></button></div>
        <button className="new-chat-button" onClick={createChat}><Plus size={17} /><span>New chat</span><kbd>⌘ K</kbd></button>
        {!sidebarCollapsed && <div className="sidebar-search"><Search size={14} /><input placeholder="Search chats" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} /><span>/</span></div>}
        <div className="chat-list-wrap"><div className="sidebar-label">{sidebarCollapsed ? "·" : "YOUR CHATS"}</div>{filteredChats.length === 0 ? <div className="sidebar-empty">{sidebarCollapsed ? <MessageSquare size={15} /> : searchTerm ? "No matching chats" : "Your chats will show up here."}</div> : <div className="chat-list">{filteredChats.map((chat) => <div className={`chat-list-item ${chat.id === activeChatId ? "active" : ""}`} key={chat.id}>
          <button onClick={() => chooseChat(chat.id)} title={chat.title}><MessageSquare size={15} /><span>{chat.title}</span></button><button className="chat-more" onClick={() => deleteChat(chat)} title="Delete chat"><Trash2 size={13} /></button>
        </div>)}</div>}</div>
        <div className="sidebar-bottom"><button className="side-tool" onClick={() => setWorkspaceOpen(true)} disabled={!activeChatId} title="Open this chat's code workspace"><TerminalSquare size={16} /><span>Code workspace</span></button><button className="side-tool" onClick={() => { setSettingsTab("plugins"); setSettingsOpen(true); }}><Puzzle size={16} /><span>Plugin workshop</span><span className="side-count">{plugins.length}</span></button><button className="side-tool" onClick={() => setSettingsOpen(true)}><Settings2 size={16} /><span>Settings</span></button><div className="account-card"><div className="account-avatar">{user ? initials(user.email) : "U"}</div><div className="account-info"><strong>{user?.email.split("@")[0]}</strong><span>{user?.email}</span></div><button className="icon-button" onClick={logout} title="Sign out"><LogOut size={15} /></button></div></div>
      </aside>

      <main className="main-area">
        <header className="topbar"><div className="topbar-left"><button className="icon-button mobile-menu" onClick={() => setSidebarOpen(true)}><Menu size={19} /></button><div className="breadcrumb"><span>workspace</span><span className="breadcrumb-sep">/</span><strong>{activeChat?.title || "new conversation"}</strong></div></div>
          <div className="topbar-right"><div className="model-picker"><span className="model-picker-label">MODEL</span><select aria-label="Provider" value={selectedProvider} onChange={(event) => updateCurrentModel(event.target.value, modelInput)}>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}</select><span className="picker-divider" /><input value={modelInput} onChange={(event) => setModelInput(event.target.value)} onBlur={() => updateCurrentModel(selectedProvider, modelInput)} onKeyDown={(event) => { if (event.key === "Enter") updateCurrentModel(selectedProvider, modelInput); }} placeholder="model id" aria-label="Model ID" /></div><button className="icon-button top-settings" onClick={() => setSettingsOpen(true)} title="Settings"><Settings2 size={17} /></button><button className="avatar-button" onClick={logout} title="Sign out">{user ? initials(user.email) : "U"}</button></div>
        </header>

        <section className="chat-stage" ref={scrollRef}>
          {!messages.length && !busy ? <div className="welcome-wrap">
            <motion.div className="welcome-orb" initial={{ opacity: 0, scale: .7, rotate: -24 }} animate={{ opacity: 1, scale: 1, rotate: 0 }} transition={{ duration: .65, ease: "easeOut" }}><div className="orb-core"><Sparkles size={27} /></div><div className="orb-ring ring-one" /><div className="orb-ring ring-two" /></motion.div>
            <div className="welcome-eyebrow"><span /> YOUR WORKSPACE IS READY</div>
            <h1>one chat.<br /><em>many brains.</em></h1>
            <p>Pick a model, bring your own API key, and get to work. The setup is yours to shape.</p>
            <div className="quick-grid">{QUICK_PROMPTS.map((item, index) => <motion.button className="quick-card" key={item.title} onClick={() => { setDraft(item.prompt); textareaRef.current?.focus(); }} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .12 + index * .07 }}><span className="quick-icon">{item.icon}</span><strong>{item.title}</strong><ArrowUpRight size={15} /></motion.button>)}</div>
            <div className="welcome-provider-row"><span>CONNECTS TO</span>{["OpenAI", "Claude", "Gemini", "Grok", "OpenRouter", "DeepSeek"].map((name) => <i key={name}>{name}</i>)}</div>
          </div> : <div className="messages-inner">{messages.map((message, index) => <ChatMessage key={message.id ?? `${message.role}-${index}`} message={message} />)}{busy && <motion.div className="thinking-row" initial={{ opacity: 0 }} animate={{ opacity: 1 }}><div className="message-avatar assistant-avatar"><Sparkles size={15} /></div><div className="thinking-content"><span>thinking</span><div className="thinking-dots"><i /><i /><i /></div></div></motion.div>}</div>}
        </section>

        <footer className="composer-area"><div className="composer-shell"><div className="composer-topline"><span><span className="secure-dot" /> PRIVATE CHAT</span><span>{providerLabel(selectedProvider, providers)}{modelInput ? ` · ${modelInput}` : " · choose a model above"}</span></div><div className="composer-input-row"><textarea ref={textareaRef} rows={1} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={handleComposerKey} placeholder="Message your model..." disabled={busy} /><button className="send-button" onClick={() => sendMessage()} disabled={!draft.trim() || busy} title="Send message">{busy ? <LoaderCircle size={18} className="spin" /> : <Send size={18} />}</button></div><div className="composer-bottom"><div><button onClick={() => setWorkspaceOpen(true)} disabled={!activeChatId}><Code2 size={13} /> Workspace</button><button onClick={() => { setSettingsTab("plugins"); setSettingsOpen(true); }}><Puzzle size={13} /> Plugins <span>{plugins.filter((plugin) => Boolean(plugin.enabled)).length}</span></button></div><span>ENTER TO SEND <b>·</b> SHIFT + ENTER FOR NEW LINE</span></div></div><div className="footer-disclaimer">The App Sucks routes requests through your chosen provider. Provider usage and billing still apply.</div></footer>
      </main>

      <AnimatePresence>{settingsOpen && <SettingsModal settings={settings} initialTab={settingsTab} onSaveSettings={saveSettings} keys={keys} onAddKey={addKey} onDeleteKey={deleteKey} plugins={plugins} onRefresh={refreshState} onClose={() => setSettingsOpen(false)} showToast={showToast} providers={providers} />}</AnimatePresence>
      <AnimatePresence>{workspaceOpen && activeChatId && <WorkspacePanel chatId={activeChatId} onClose={() => setWorkspaceOpen(false)} showToast={showToast} />}</AnimatePresence>
      <AnimatePresence>{toast && <motion.div className={`toast toast-${toast.tone}`} initial={{ opacity: 0, y: 16, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10 }}><span>{toast.tone === "success" ? <CheckCircle2 size={16} /> : toast.tone === "error" ? <AlertCircle size={16} /> : <Sparkles size={16} />}</span>{toast.message}</motion.div>}</AnimatePresence>
    </div>
  );
}

export default App;
