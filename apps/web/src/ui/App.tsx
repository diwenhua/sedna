import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bot,
  ChevronDown,
  ChevronRight,
  Check,
  Circle,
  ClipboardList,
  Database,
  GitBranch,
  Inbox,
  MessageSquare,
  Pencil,
  Plus,
  Send,
  Settings as SettingsIcon,
  ShieldCheck,
  UserRound,
  X
} from "lucide-react";
import { Background, Controls, ReactFlow, type Edge, type Node } from "@xyflow/react";
import type {
  AssistantReplyLocale,
  AuditRecord,
  Evidence,
  Event,
  GraphResponse,
  LlmAdapterType,
  LlmRoutePurpose,
  MemoryCandidate,
  Message,
  UiLocale,
  Worker
} from "@sedna/protocol";
import {
  approveCandidate,
  createLlmProvider,
  createMcpServer,
  createSkill,
  createConversation,
  disableLlmProvider,
  disableMcpServer,
  editCandidate,
  getAudit,
  getCandidates,
  getConversations,
  getConversation,
  getGraph,
  getLlmProviderPresets,
  getLlmProviders,
  getLlmRoutes,
  getMcpServers,
  getSettings,
  getSkills,
  getTimeline,
  getTools,
  getWorkers,
  patchMcpServer,
  patchLlmProvider,
  patchLlmRoute,
  patchSettings,
  patchSkill,
  patchToolPolicy,
  registerMockWorker,
  rejectCandidate,
  refreshMcpServer,
  sendMessage,
  sendMessageStream,
  testMcpServer,
  testLlmProvider,
  testSkillRun,
  testTool,
  type LlmModelRouteResponse,
  type LlmProviderPresetResponse,
  type LlmProviderResponse,
  type McpServerResponse,
  type SkillResponse,
  type ToolRegistryResponse
} from "../api.js";
import { assistantReplyLocaleLabel, createTranslator, type TranslationKey } from "../i18n/index.js";

type MainTab = "chat" | "memory" | "tasks" | "graph" | "activity" | "audit" | "settings";
type AgentRunStatus = "running" | "waiting_confirmation" | "completed" | "failed";
type AgentStepStatus = "pending" | "running" | "waiting_confirmation" | "completed" | "failed";
type PolicyResultStatus = "allowed" | "needs_confirmation" | "blocked";
type TaskStatus = "suggested" | "accepted" | "dismissed";
type ConfirmationStatus = "pending" | "approved" | "rejected";

interface LanguageSettings {
  uiLocale: UiLocale;
  assistantReplyLocale: AssistantReplyLocale;
}

interface ProviderDraft {
  id?: string;
  presetId?: string;
  displayName: string;
  adapterType: LlmAdapterType;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  enabled: boolean;
}

interface McpServerDraft {
  id?: string;
  name: string;
  transport: "stdio" | "streamable_http";
  command: string;
  args: string;
  url: string;
  headers: string;
  enabled: boolean;
  trustLevel: "untrusted" | "trusted" | "first_party";
}

interface SkillDraft {
  name: string;
  description: string;
  instructionMarkdown: string;
  requiredTools: string;
  riskLevel: "low" | "medium" | "high";
  enabled: boolean;
}

interface ChatActivity {
  id: string;
  title: string;
}

interface AgentAction {
  type: string;
  risk: "low" | "medium" | "high";
  requiresConfirmation: boolean;
  payload: Record<string, unknown>;
}

interface PolicyResult {
  result: PolicyResultStatus;
  reason: string;
}

interface AgentStep {
  id: string;
  index: number;
  status: AgentStepStatus;
  thoughtSummary: string;
  action: AgentAction;
  policy: PolicyResult;
  observationSummary?: string;
  error?: string;
}

interface AgentRun {
  id: string;
  status: AgentRunStatus;
  title: string;
  sourceMessage: string;
  steps: AgentStep[];
  finalResult?: string;
  startedAt: string;
  completedAt?: string;
}

interface ConfirmationItem {
  id: string;
  runId: string;
  stepId: string;
  title: string;
  actionType: string;
  risk: "medium" | "high";
  payload: Record<string, unknown>;
  status: ConfirmationStatus;
  createdAt: string;
}

interface TaskItem {
  id: string;
  title: string;
  status: TaskStatus;
  sourceRunId: string;
  sourceStepId: string;
  createdAt: string;
}

const seedMessages = [
  "I prefer concise implementation plans. My project is Sedna Brain MVP.",
  "Never upload .env files."
];

export function App() {
  const [conversationId, setConversationId] = useState<string>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatActivities, setChatActivities] = useState<ChatActivity[]>([]);
  const [agentRuns, setAgentRuns] = useState<AgentRun[]>([]);
  const [confirmations, setConfirmations] = useState<ConfirmationItem[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [timeline, setTimeline] = useState<Array<Event | Message>>([]);
  const [candidates, setCandidates] = useState<MemoryCandidate[]>([]);
  const [graph, setGraph] = useState<GraphResponse>({ nodes: [], edges: [], evidence: [] });
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [audit, setAudit] = useState<AuditRecord[]>([]);
  const [activeTab, setActiveTab] = useState<MainTab>("chat");
  const [graphView, setGraphView] = useState("Profile");
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("Ready");
  const cachedLocale = readCachedLocale();
  const [settings, setSettings] = useState<LanguageSettings>({
    uiLocale: cachedLocale,
    assistantReplyLocale: "follow_ui"
  });
  const [settingsDraft, setSettingsDraft] = useState<LanguageSettings>({
    uiLocale: cachedLocale,
    assistantReplyLocale: "follow_ui"
  });
  const [providerPresets, setProviderPresets] = useState<LlmProviderPresetResponse[]>([]);
  const [llmProviders, setLlmProviders] = useState<LlmProviderResponse[]>([]);
  const [llmRoutes, setLlmRoutes] = useState<LlmModelRouteResponse[]>([]);
  const [providerDraft, setProviderDraft] = useState<ProviderDraft>(emptyProviderDraft());
  const [mcpServers, setMcpServers] = useState<McpServerResponse[]>([]);
  const [tools, setTools] = useState<ToolRegistryResponse[]>([]);
  const [skills, setSkills] = useState<SkillResponse[]>([]);
  const [mcpDraft, setMcpDraft] = useState<McpServerDraft>(emptyMcpDraft());
  const [skillDraft, setSkillDraft] = useState<SkillDraft>(emptySkillDraft());
  const [testResult, setTestResult] = useState<string>("");
  const t = useMemo(() => createTranslator(settings.uiLocale), [settings.uiLocale]);

  const refresh = useCallback(async (id = conversationId, view = graphView) => {
    const [nextTimeline, nextCandidates, nextGraph, nextWorkers, nextAudit] = await Promise.all([
      getTimeline(),
      getCandidates(),
      getGraph(view),
      getWorkers(),
      getAudit()
    ]);
    setTimeline(nextTimeline);
    setCandidates(nextCandidates);
    setGraph(nextGraph);
    setWorkers(nextWorkers);
    setAudit(nextAudit);
    if (id) {
      const conversation = await getConversation(id);
      setMessages(conversation.messages);
    }
  }, [conversationId, graphView]);

  const refreshLlm = useCallback(async () => {
    const [presets, providers, routes] = await Promise.all([
      getLlmProviderPresets(),
      getLlmProviders(),
      getLlmRoutes()
    ]);
    setProviderPresets(presets);
    setLlmProviders(providers);
    setLlmRoutes(routes);
  }, []);

  const refreshRuntimeConfig = useCallback(async () => {
    const [servers, registryTools, skillList] = await Promise.all([
      getMcpServers(),
      getTools(),
      getSkills()
    ]);
    setMcpServers(servers);
    setTools(registryTools);
    setSkills(skillList);
  }, []);

  useEffect(() => {
    async function boot() {
      try {
        setStatus(t("connecting"));
        const brainSettings = await getSettings();
        const nextSettings = {
          uiLocale: brainSettings.ui_locale,
          assistantReplyLocale: brainSettings.assistant_reply_locale
        };
        setSettings(nextSettings);
        setSettingsDraft(nextSettings);
        localStorage.setItem("sedna.ui_locale", nextSettings.uiLocale);
        await refreshLlm();
        await refreshRuntimeConfig();
        const existing = await getConversations();
        const conversation = existing[0] ?? await createConversation("Sedna Brain MVP");
        setConversationId(conversation.id);
        const fullConversation = await getConversation(conversation.id);
        if (fullConversation.messages.length === 0) {
          for (const content of seedMessages) {
            await sendMessage(conversation.id, content);
          }
        }
        await refresh(conversation.id);
        setStatus(createTranslator(nextSettings.uiLocale)("selfHosted"));
      } catch (error) {
        setStatus(error instanceof Error ? error.message : t("brainUnavailable"));
      }
    }
    void boot();
  }, []);

  async function submitMessage() {
    if (!conversationId || draft.trim().length === 0) {
      return;
    }
    const content = draft.trim();
    const ownerTempId = `temp_owner_${Date.now()}`;
    const assistantTempId = `temp_assistant_${Date.now()}`;
    const now = new Date().toISOString();
    const run = createAgentRun(content, now, t);
    const needsConfirmation = shouldRequireConfirmation(content);
    const task = shouldCreateTask(content) ? createTaskFromRequest(content, run, now, t) : undefined;
    const confirmation = needsConfirmation ? createConfirmationForRun(run, now, t) : undefined;
    setDraft("");
    setStatus(t("sending"));
    setChatActivities([{ id: "queued", title: t("queued") }]);
    setAgentRuns((current) => [confirmation ? markRunWaiting(run, t) : run, ...current]);
    if (task) {
      setTasks((current) => [task, ...current]);
    }
    if (confirmation) {
      setConfirmations((current) => [confirmation, ...current]);
    }
    setMessages((current) => [
      ...current,
      {
        id: ownerTempId,
        conversationId,
        role: "owner",
        content,
        metadata: { temporary: true },
        locale: settings.uiLocale,
        createdAt: now
      },
      {
        id: assistantTempId,
        conversationId,
        role: "assistant",
        content: "",
        metadata: { temporary: true, pending: true },
        locale: settings.uiLocale,
        createdAt: now
      }
    ]);
    try {
      await sendMessageStream(conversationId, content, (event) => {
        if (event.type === "owner_message") {
          setMessages((current) => current.map((message) => message.id === ownerTempId ? event.payload.message : message));
          updateAgentRun(run.id, (currentRun) => ({
            ...currentRun,
            steps: updateStep(currentRun.steps, 0, {
              status: confirmation ? "waiting_confirmation" : "running",
              observationSummary: t("ownerMessageSaved")
            })
          }));
        }
        if (event.type === "assistant_status") {
          setChatActivities((current) => [...current, { id: `${event.payload.phase}_${Date.now()}`, title: event.payload.title }]);
          if (event.payload.phase === "memory_extraction") {
            updateAgentRun(run.id, (currentRun) => addOrUpdateMemoryStep(currentRun, t));
          }
        }
        if (event.type === "assistant_delta") {
          setMessages((current) => current.map((message) =>
            message.id === assistantTempId
              ? { ...message, content: `${message.content}${event.payload.content}`, metadata: { ...message.metadata, pending: true } }
              : message
          ));
        }
        if (event.type === "assistant_message") {
          setMessages((current) => current.map((message) =>
            message.id === assistantTempId
              ? { ...event.payload.message, content: message.content || event.payload.message.content }
              : message
          ));
          updateAgentRun(run.id, (currentRun) => ({
            ...currentRun,
            status: currentRun.status === "waiting_confirmation" ? "waiting_confirmation" : "running",
            finalResult: event.payload.message.content,
            steps: updateStep(currentRun.steps, 0, {
              status: currentRun.status === "waiting_confirmation" ? "waiting_confirmation" : "completed",
              observationSummary: t("assistantReplySaved")
            })
          }));
        }
        if (event.type === "memory_candidates") {
          setCandidates(event.payload.candidates);
          updateAgentRun(run.id, (currentRun) => addOrUpdateMemoryStep(currentRun, t, event.payload.candidates.length));
        }
        if (event.type === "error") {
          setStatus(`${t("messageFailed")}: ${event.payload.message}`);
          updateAgentRun(run.id, (currentRun) => ({
            ...currentRun,
            status: "failed",
            completedAt: new Date().toISOString(),
            steps: updateStep(currentRun.steps, currentRun.steps.length - 1, {
              status: "failed",
              error: event.payload.message
            })
          }));
        }
        if (event.type === "done") {
          updateAgentRun(run.id, (currentRun) => ({
            ...currentRun,
            status: currentRun.status === "waiting_confirmation" ? "waiting_confirmation" : "completed",
            finalResult: event.payload.assistantMessage.content,
            completedAt: new Date().toISOString(),
            steps: currentRun.steps.map((step) => step.status === "running" || step.status === "pending"
              ? { ...step, status: "completed", observationSummary: step.observationSummary ?? t("stepCompleted") }
              : step)
          }));
        }
      });
      await refresh(conversationId);
      setChatActivities([]);
      setStatus(t("selfHosted"));
    } catch (error) {
      setStatus(error instanceof Error ? `${t("messageFailed")}: ${error.message}` : t("messageFailed"));
      setMessages((current) => current.filter((message) => message.id !== ownerTempId && message.id !== assistantTempId));
      setChatActivities([]);
      setDraft(content);
    }
  }

  async function handleApprove(candidate: MemoryCandidate) {
    await approveCandidate(candidate.id);
    await refresh();
  }

  async function handleReject(candidate: MemoryCandidate) {
    await rejectCandidate(candidate.id);
    await refresh();
  }

  async function handleEdit(candidate: MemoryCandidate) {
    const label = window.prompt(t("editMemoryLabel"), candidate.label);
    if (!label || label === candidate.label) {
      return;
    }
    await editCandidate(candidate.id, label);
    await refresh();
  }

  async function handleMockWorker() {
    await registerMockWorker();
    await refresh(undefined, "Worker");
    setGraphView("Worker");
    setActiveTab("graph");
  }

  async function handleSaveSettings() {
    try {
      const next = await patchSettings({
        ui_locale: settingsDraft.uiLocale,
        assistant_reply_locale: settingsDraft.assistantReplyLocale
      });
      const normalized = {
        uiLocale: next.ui_locale,
        assistantReplyLocale: next.assistant_reply_locale
      };
      setSettings(normalized);
      setSettingsDraft(normalized);
      localStorage.setItem("sedna.ui_locale", normalized.uiLocale);
      setStatus(createTranslator(normalized.uiLocale)("settingsSaved"));
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t("settingsFailed"));
    }
  }

  async function handleSaveProvider() {
    const payload = {
      preset_id: providerDraft.presetId || undefined,
      display_name: providerDraft.displayName,
      adapter_type: providerDraft.adapterType,
      base_url: providerDraft.baseUrl || undefined,
      api_key: providerDraft.apiKey || undefined,
      default_model: providerDraft.defaultModel,
      enabled: providerDraft.enabled
    };
    if (providerDraft.id) {
      await patchLlmProvider(providerDraft.id, payload);
    } else {
      await createLlmProvider(payload);
    }
    setProviderDraft(emptyProviderDraft());
    await refreshLlm();
  }

  async function handleEditProvider(provider: LlmProviderResponse) {
    setProviderDraft({
      id: provider.id,
      presetId: provider.preset_id,
      displayName: provider.display_name,
      adapterType: provider.adapter_type,
      baseUrl: provider.base_url ?? "",
      apiKey: "",
      defaultModel: provider.default_model,
      enabled: provider.enabled
    });
  }

  async function handleDisableProvider(provider: LlmProviderResponse) {
    await disableLlmProvider(provider.id);
    await refreshLlm();
  }

  async function handleTestProvider(provider: LlmProviderResponse) {
    const result = await testLlmProvider(provider.id);
    setTestResult(`${result.ok ? t("connectionPassed") : t("connectionFailed")}: ${result.message}`);
  }

  async function handlePatchRoute(purpose: LlmRoutePurpose, patch: Partial<{
    provider_config_id: string;
    model: string;
    temperature: number;
    max_tokens: number;
    enabled: boolean;
  }>) {
    await patchLlmRoute(purpose, patch);
    await refreshLlm();
  }

  async function handleSaveMcpServer() {
    const payload = {
      name: mcpDraft.name,
      transport: mcpDraft.transport,
      command: mcpDraft.command || undefined,
      args: mcpDraft.args.split(/\s+/).map((item) => item.trim()).filter(Boolean),
      url: mcpDraft.url || undefined,
      headers: parseHeaderDraft(mcpDraft.headers),
      enabled: mcpDraft.enabled,
      trust_level: mcpDraft.trustLevel
    };
    if (mcpDraft.id) {
      await patchMcpServer(mcpDraft.id, payload);
    } else {
      await createMcpServer(payload);
    }
    setMcpDraft(emptyMcpDraft());
    await refreshRuntimeConfig();
  }

  async function handleEditMcpServer(server: McpServerResponse) {
    setMcpDraft({
      id: server.id,
      name: server.name,
      transport: server.transport,
      command: server.command ?? "",
      args: server.args.join(" "),
      url: server.url ?? "",
      headers: "",
      enabled: server.enabled,
      trustLevel: server.trust_level
    });
  }

  async function handleDisableMcpServer(server: McpServerResponse) {
    await disableMcpServer(server.id);
    await refreshRuntimeConfig();
  }

  async function handleTestMcpServer(server: McpServerResponse) {
    const result = await testMcpServer(server.id);
    setTestResult(`${result.ok ? t("connectionPassed") : t("connectionFailed")}: ${result.message}`);
    await refreshRuntimeConfig();
  }

  async function handleRefreshMcpServer(server: McpServerResponse) {
    const result = await refreshMcpServer(server.id);
    setTestResult(`${t("mcpRefreshComplete")}: ${result.tools.length}`);
    await refreshRuntimeConfig();
  }

  async function handlePatchTool(tool: ToolRegistryResponse, patch: Partial<{
    risk_level: "low" | "medium" | "high";
    requires_confirmation: boolean;
    enabled: boolean;
  }>) {
    await patchToolPolicy(tool.id, patch);
    await refreshRuntimeConfig();
  }

  async function handleTestTool(tool: ToolRegistryResponse) {
    const result = await testTool(tool.id, { text: "Sedna tool registry smoke check" });
    setTestResult(`${t("toolTestResult")}: ${JSON.stringify(result)}`);
    await refreshRuntimeConfig();
  }

  async function handleSaveSkill() {
    await createSkill({
      name: skillDraft.name,
      description: skillDraft.description,
      instruction_markdown: skillDraft.instructionMarkdown,
      required_tools: skillDraft.requiredTools.split(",").map((item) => item.trim()).filter(Boolean),
      risk_level: skillDraft.riskLevel,
      enabled: skillDraft.enabled
    });
    setSkillDraft(emptySkillDraft());
    await refreshRuntimeConfig();
  }

  async function handleToggleSkill(skill: SkillResponse) {
    await patchSkill(skill.id, { enabled: !skill.enabled });
    await refreshRuntimeConfig();
  }

  async function handleTestSkill(skill: SkillResponse) {
    const result = await testSkillRun(skill.id, { goal: "Sedna skill smoke check" });
    setTestResult(`${t("skillRunResult")}: ${result.status}`);
    await refreshRuntimeConfig();
  }

  async function changeGraphView(view: string) {
    setGraphView(view);
    setGraph(await getGraph(view));
  }

  function updateAgentRun(runId: string, updater: (run: AgentRun) => AgentRun) {
    setAgentRuns((current) => current.map((run) => run.id === runId ? updater(run) : run));
  }

  function handleApproveConfirmation(confirmation: ConfirmationItem) {
    setConfirmations((current) => current.map((item) => item.id === confirmation.id ? { ...item, status: "approved" } : item));
    setAgentRuns((current) => current.map((run) => run.id === confirmation.runId ? {
      ...run,
      status: "completed",
      completedAt: new Date().toISOString(),
      steps: run.steps.map((step) => step.id === confirmation.stepId ? {
        ...step,
        status: "completed",
        observationSummary: t("confirmationApproved")
      } : step)
    } : run));
  }

  function handleRejectConfirmation(confirmation: ConfirmationItem) {
    setConfirmations((current) => current.map((item) => item.id === confirmation.id ? { ...item, status: "rejected" } : item));
    setAgentRuns((current) => current.map((run) => run.id === confirmation.runId ? {
      ...run,
      status: "completed",
      completedAt: new Date().toISOString(),
      steps: run.steps.map((step) => step.id === confirmation.stepId ? {
        ...step,
        status: "completed",
        observationSummary: t("confirmationRejected")
      } : step)
    } : run));
  }

  function handleTaskStatus(task: TaskItem, status: TaskStatus) {
    setTasks((current) => current.map((item) => item.id === task.id ? { ...item, ...task, status } : item));
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Bot size={22} /></div>
          <div>
            <strong>Sedna Brain</strong>
            <span>{t("centralBrain")}</span>
          </div>
        </div>
        <nav className="nav-list">
          <NavItem icon={<MessageSquare size={17} />} label={t("navChat")} active={activeTab === "chat"} onClick={() => setActiveTab("chat")} />
          <NavItem icon={<Inbox size={17} />} label={t("navMemory")} active={activeTab === "memory"} onClick={() => setActiveTab("memory")} />
          <NavItem icon={<ClipboardList size={17} />} label={t("navTasks")} active={activeTab === "tasks"} onClick={() => setActiveTab("tasks")} />
          <NavItem icon={<GitBranch size={17} />} label={t("navGraph")} active={activeTab === "graph"} onClick={() => setActiveTab("graph")} />
          <NavItem icon={<Activity size={17} />} label={t("navAgents")} active={activeTab === "activity"} onClick={() => setActiveTab("activity")} />
          <NavItem icon={<Database size={17} />} label={t("navAudit")} active={activeTab === "audit"} onClick={() => setActiveTab("audit")} />
          <NavItem icon={<SettingsIcon size={17} />} label={t("navSettings")} active={activeTab === "settings"} onClick={() => setActiveTab("settings")} />
        </nav>
        <div className="system-list">
          <span className="section-label">{t("system")}</span>
          <SystemRow label={t("graphDb")} />
          <SystemRow label={t("memoryInbox")} />
          <SystemRow label={t("workers")} count={workers.length} />
        </div>
        <div className="policy-box">
          <ShieldCheck size={18} />
          <div>
            <strong>{t("policyMode")}</strong>
            <span>{t("privacyFirst")}</span>
          </div>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="status-pill"><Circle size={9} fill="currentColor" /> {status}</div>
          <div className="search">{t("searchPlaceholder")}</div>
          <button className="ghost-button" onClick={handleMockWorker}><Plus size={16} /> {t("mockWorker")}</button>
          <div className="owner-chip"><UserRound size={16} /> {t("owner")}</div>
        </header>

        <section className="content-surface">
          {activeTab === "chat" && (
            <ChatTimeline
              messages={messages}
              draft={draft}
              setDraft={setDraft}
              submitMessage={submitMessage}
              t={t}
              locale={settings.uiLocale}
              activities={chatActivities}
              agentRuns={agentRuns}
              confirmations={confirmations}
              tasks={tasks}
              candidates={candidates}
              onApproveConfirmation={handleApproveConfirmation}
              onRejectConfirmation={handleRejectConfirmation}
              onTaskStatus={handleTaskStatus}
            />
          )}
          {activeTab === "memory" && (
            <section className="panel feature-panel">
              <div className="panel-header">
                <h1>{t("memoryInbox")}</h1>
                <span>{candidates.length}</span>
              </div>
              <MemoryInbox
                candidates={candidates}
                onApprove={handleApprove}
                onReject={handleReject}
                onEdit={handleEdit}
                evidence={graph.evidence}
                t={t}
              />
            </section>
          )}
          {activeTab === "tasks" && (
            <TaskPanel tasks={tasks} onTaskStatus={handleTaskStatus} t={t} locale={settings.uiLocale} />
          )}
          {activeTab === "graph" && (
            <GraphPanel graph={graph} view={graphView} onChangeView={changeGraphView} t={t} />
          )}
          {activeTab === "activity" && (
            <AgentActivityPanel runs={agentRuns} confirmations={confirmations} t={t} locale={settings.uiLocale} />
          )}
          {activeTab === "audit" && (
            <AuditPanel audit={audit} t={t} locale={settings.uiLocale} />
          )}
          {activeTab === "settings" && (
            <section className="panel feature-panel">
              <SettingsPanel
                settings={settingsDraft}
                onChange={setSettingsDraft}
                onSave={handleSaveSettings}
                onCancel={() => setSettingsDraft(settings)}
                providerPresets={providerPresets}
                providers={llmProviders}
                routes={llmRoutes}
                providerDraft={providerDraft}
                onProviderDraftChange={setProviderDraft}
                onSaveProvider={handleSaveProvider}
                onEditProvider={handleEditProvider}
                onDisableProvider={handleDisableProvider}
                onTestProvider={handleTestProvider}
                onPatchRoute={handlePatchRoute}
                testResult={testResult}
                mcpServers={mcpServers}
                tools={tools}
                skills={skills}
                mcpDraft={mcpDraft}
                skillDraft={skillDraft}
                onMcpDraftChange={setMcpDraft}
                onSkillDraftChange={setSkillDraft}
                onSaveMcpServer={handleSaveMcpServer}
                onEditMcpServer={handleEditMcpServer}
                onDisableMcpServer={handleDisableMcpServer}
                onTestMcpServer={handleTestMcpServer}
                onRefreshMcpServer={handleRefreshMcpServer}
                onPatchTool={handlePatchTool}
                onTestTool={handleTestTool}
                onSaveSkill={handleSaveSkill}
                onToggleSkill={handleToggleSkill}
                onTestSkill={handleTestSkill}
                t={t}
              />
            </section>
          )}
        </section>
      </main>
    </div>
  );
}

function NavItem({ icon, label, active = false, onClick }: { icon: React.ReactNode; label: string; active?: boolean; onClick?: () => void }) {
  return <button className={`nav-item ${active ? "active" : ""}`} onClick={onClick}>{icon}<span>{label}</span></button>;
}

function SystemRow({ label, count }: { label: string; count?: number }) {
  return <div className="system-row"><span>{label}</span>{count !== undefined ? <strong>{count}</strong> : <Circle size={8} fill="currentColor" />}</div>;
}

function ChatTimeline({
  messages,
  draft,
  setDraft,
  submitMessage,
  t,
  locale,
  activities,
  agentRuns,
  confirmations,
  tasks,
  candidates,
  onApproveConfirmation,
  onRejectConfirmation,
  onTaskStatus
}: {
  messages: Message[];
  draft: string;
  setDraft: (value: string) => void;
  submitMessage: () => void;
  t: (key: TranslationKey) => string;
  locale: UiLocale;
  activities: ChatActivity[];
  agentRuns: AgentRun[];
  confirmations: ConfirmationItem[];
  tasks: TaskItem[];
  candidates: MemoryCandidate[];
  onApproveConfirmation: (confirmation: ConfirmationItem) => void;
  onRejectConfirmation: (confirmation: ConfirmationItem) => void;
  onTaskStatus: (task: TaskItem, status: TaskStatus) => void;
}) {
  const messageListRef = useRef<HTMLDivElement>(null);
  const timelineRuns = agentRuns.slice(0, 2);
  const openConfirmations = confirmations.filter((item) => item.status === "pending").slice(0, 2);
  const recentTasks = tasks.slice(0, 3);
  const recentCandidates = candidates.slice(0, 2);

  useEffect(() => {
    const list = messageListRef.current;
    if (list) {
      list.scrollTop = list.scrollHeight;
    }
  }, [messages.length, activities.length]);

  return (
    <section className="panel chat-panel">
      <div className="panel-header">
        <h1>{t("chatTimeline")}</h1>
        <span>{messages.length} {t("messages")}</span>
      </div>
      <div className="message-list" ref={messageListRef}>
        {messages.map((message) => (
          <article className={`message ${message.role}`} key={message.id}>
            <div className="avatar">{message.role === "assistant" ? <Bot size={18} /> : "OS"}</div>
            <div>
              <div className="message-meta"><strong>{message.role === "assistant" ? t("sednaBrain") : t("owner")}</strong><span>{new Date(message.createdAt).toLocaleTimeString(locale)}</span></div>
              <p>{message.content}{message.metadata.pending === true ? <span className="stream-caret" /> : null}</p>
              {message.role === "assistant" && message.metadata.pending === true && activities.length > 0 && (
                <div className="agent-steps">
                  {activities.slice(-4).map((activity) => (
                    <span key={activity.id}>{activity.title}</span>
                  ))}
                </div>
              )}
            </div>
          </article>
        ))}
        {(timelineRuns.length > 0 || openConfirmations.length > 0 || recentTasks.length > 0 || recentCandidates.length > 0) && (
          <div className="timeline-card-stack" aria-label={t("agentTimelineUpdates")}>
            {timelineRuns.map((run) => (
              <AgentRunSummaryCard run={run} key={run.id} t={t} locale={locale} />
            ))}
            {openConfirmations.map((confirmation) => (
              <ConfirmationCard
                confirmation={confirmation}
                key={confirmation.id}
                onApprove={onApproveConfirmation}
                onReject={onRejectConfirmation}
                t={t}
              />
            ))}
            {recentTasks.map((task) => (
              <TaskCard task={task} key={task.id} onTaskStatus={onTaskStatus} t={t} locale={locale} compact />
            ))}
            {recentCandidates.map((candidate) => (
              <MemoryCandidateCard candidate={candidate} key={candidate.id} t={t} />
            ))}
          </div>
        )}
      </div>
      <div className="composer">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              void submitMessage();
            }
          }}
          placeholder={t("messagePlaceholder")}
        />
        <button className="send-button" onClick={() => void submitMessage()} aria-label={t("sendMessage")} title={t("sendMessage")}><Send size={18} /></button>
      </div>
    </section>
  );
}

function MemoryInbox({
  candidates,
  onApprove,
  onReject,
  onEdit,
  evidence,
  t
}: {
  candidates: MemoryCandidate[];
  onApprove: (candidate: MemoryCandidate) => void;
  onReject: (candidate: MemoryCandidate) => void;
  onEdit: (candidate: MemoryCandidate) => void;
  evidence: Evidence[];
  t: (key: TranslationKey) => string;
}) {
  const evidenceById = useMemo(() => new Map(evidence.map((item) => [item.id, item])), [evidence]);
  return (
    <div className="memory-table">
      <div className="table-head"><span>{t("candidate")}</span><span>{t("confidence")}</span><span>{t("risk")}</span><span>{t("status")}</span><span>{t("actions")}</span></div>
      {candidates.length === 0 && <div className="empty-state">{t("noMemoryCandidates")}</div>}
      {candidates.map((candidate) => {
        const firstEvidence = candidate.evidenceIds.map((id) => evidenceById.get(id)).find(Boolean);
        return (
          <div className="candidate-row" key={candidate.id}>
            <div>
              <strong>{candidate.label}</strong>
              <small>{candidate.kind} · {t("source")}: {sourceLabel(candidate)}</small>
              {firstEvidence?.quote && <blockquote>{firstEvidence.quote}</blockquote>}
            </div>
            <div className="confidence"><span style={{ width: `${candidate.confidence * 100}%` }} />{candidate.confidence.toFixed(2)}</div>
            <RiskBadge risk={candidate.risk} t={t} />
            <span className={`status-badge ${candidate.status}`}>{statusLabel(candidate.status, t)}</span>
            <div className="row-actions">
              <button onClick={() => onApprove(candidate)} title={t("approve")}><Check size={15} /></button>
              <button onClick={() => onReject(candidate)} title={t("reject")}><X size={15} /></button>
              <button onClick={() => onEdit(candidate)} title={t("edit")}><Pencil size={15} /></button>
              <button onClick={() => onReject(candidate)} title={t("quarantine")}><AlertTriangle size={15} /></button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RiskBadge({ risk, t }: { risk: string; t: (key: TranslationKey) => string }) {
  return <span className={`risk-badge ${risk}`}>{riskLabel(risk, t)}</span>;
}

function GraphPanel({ graph, view, onChangeView, t, compact = false }: { graph: GraphResponse; view: string; onChangeView: (view: string) => void; t: (key: TranslationKey) => string; compact?: boolean }) {
  const flow = useMemo(() => toFlow(graph), [graph]);
  return (
    <section className={`panel graph-panel ${compact ? "compact" : ""}`}>
      <div className="panel-header">
        <h2>{t("graphView")}</h2>
        <select value={view} onChange={(event) => void onChangeView(event.target.value)}>
          <option>Profile</option>
          <option>Project</option>
          <option>Resource</option>
          <option>Worker</option>
        </select>
      </div>
      <div className="flow-wrap">
        <ReactFlow nodes={flow.nodes} edges={flow.edges} fitView>
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <div className="graph-detail-list">
        {graph.nodes.slice(0, 4).map((node) => (
          <div className="graph-detail-row" key={node.id}>
            <strong>{node.label}</strong>
            <span>{node.type} · {t("sourceRun")}: {String(node.payload.sourceRunId ?? node.origin)}</span>
          </div>
        ))}
        {graph.evidence.slice(0, 2).map((item) => (
          <blockquote key={item.id}>{item.quote ?? item.sourceId}</blockquote>
        ))}
      </div>
      <footer className="panel-footer">{t("nodes")}: {graph.nodes.length} · {t("edges")}: {graph.edges.length} · {t("evidence")}: {graph.evidence.length}</footer>
    </section>
  );
}

function AgentActivityPanel({ runs, confirmations, t, locale }: { runs: AgentRun[]; confirmations: ConfirmationItem[]; t: (key: TranslationKey) => string; locale: UiLocale }) {
  return (
    <section className="panel activity-panel">
      <div className="panel-header">
        <h2>{t("agentActivity")}</h2>
        <span>{runs.length} {t("runs")}</span>
      </div>
      <div className="agent-run-list">
        {runs.length === 0 && <div className="empty-state">{t("noAgentRuns")}</div>}
        {runs.map((run) => (
          <AgentRunCard run={run} confirmations={confirmations.filter((item) => item.runId === run.id)} key={run.id} t={t} locale={locale} />
        ))}
      </div>
    </section>
  );
}

function AgentRunCard({ run, confirmations, t, locale }: { run: AgentRun; confirmations: ConfirmationItem[]; t: (key: TranslationKey) => string; locale: UiLocale }) {
  return (
    <details className={`run-card ${run.status}`} open={run.status === "running" || run.status === "waiting_confirmation"}>
      <summary>
        <span className="summary-caret"><ChevronRight size={15} /></span>
        <div>
          <strong>{run.title}</strong>
          <span>{new Date(run.startedAt).toLocaleTimeString(locale)} · {run.steps.length} {t("steps")}</span>
        </div>
        <RunStatusBadge status={run.status} t={t} />
      </summary>
      <div className="run-body">
        <p className="run-source">{run.sourceMessage}</p>
        <div className="step-list">
          {run.steps.map((step) => (
            <AgentStepCard step={step} key={step.id} t={t} />
          ))}
        </div>
        {confirmations.length > 0 && (
          <div className="run-confirmation-note">{confirmations.map((item) => `${item.title}: ${confirmationStatusLabel(item.status, t)}`).join(" · ")}</div>
        )}
        {run.finalResult && <div className="final-result"><strong>{t("finalResult")}</strong><p>{run.finalResult}</p></div>}
      </div>
    </details>
  );
}

function AgentStepCard({ step, t }: { step: AgentStep; t: (key: TranslationKey) => string }) {
  return (
    <details className={`step-card ${step.status}`}>
      <summary>
        <span className="summary-caret"><ChevronRight size={14} /></span>
        <strong>{t("step")} {step.index}</strong>
        <StepStatusBadge status={step.status} t={t} />
        <RiskBadge risk={step.action.risk} t={t} />
        {step.action.requiresConfirmation && <span className="status-badge waiting">{t("requiresConfirmation")}</span>}
      </summary>
      <div className="step-detail">
        <Field label={t("thoughtSummary")} value={step.thoughtSummary} />
        <Field label={t("actionType")} value={step.action.type} />
        <Field label={t("policyResult")} value={`${policyResultLabel(step.policy.result, t)} · ${step.policy.reason}`} />
        {step.observationSummary && <Field label={t("observationSummary")} value={step.observationSummary} />}
        {step.error && <Field label={t("error")} value={step.error} tone="danger" />}
        <ActionPayloadViewer payload={step.action.payload} t={t} />
      </div>
    </details>
  );
}

function ActionPayloadViewer({ payload, t }: { payload: Record<string, unknown>; t: (key: TranslationKey) => string }) {
  return (
    <details className="payload-viewer">
      <summary><ChevronRight size={13} /> {t("actionPayload")}</summary>
      <pre>{JSON.stringify(payload, null, 2)}</pre>
    </details>
  );
}

function Field({ label, value, tone }: { label: string; value: string; tone?: "danger" }) {
  return <div className={`field-row ${tone ?? ""}`}><span>{label}</span><p>{value}</p></div>;
}

function AgentRunSummaryCard({ run, t, locale }: { run: AgentRun; t: (key: TranslationKey) => string; locale: UiLocale }) {
  const latestStep = run.steps[run.steps.length - 1];
  return (
    <article className={`workbench-card run-summary ${run.status}`}>
      <div className="card-icon"><Activity size={16} /></div>
      <div>
        <div className="card-line"><strong>{t("agentRun")}</strong><RunStatusBadge status={run.status} t={t} /></div>
        <p>{latestStep?.thoughtSummary ?? run.title}</p>
        <small>{new Date(run.startedAt).toLocaleTimeString(locale)} · {run.steps.length} {t("steps")}</small>
      </div>
    </article>
  );
}

function ConfirmationCard({ confirmation, onApprove, onReject, t }: { confirmation: ConfirmationItem; onApprove: (confirmation: ConfirmationItem) => void; onReject: (confirmation: ConfirmationItem) => void; t: (key: TranslationKey) => string }) {
  return (
    <article className="workbench-card confirmation-card">
      <div className="card-icon warning"><AlertTriangle size={16} /></div>
      <div>
        <div className="card-line"><strong>{t("confirmationRequired")}</strong><RiskBadge risk={confirmation.risk} t={t} /></div>
        <p>{confirmation.title}</p>
        <small>{confirmation.actionType}</small>
        <div className="inline-actions">
          <button onClick={() => onApprove(confirmation)}><Check size={14} /> {t("approve")}</button>
          <button onClick={() => onReject(confirmation)}><X size={14} /> {t("reject")}</button>
        </div>
      </div>
    </article>
  );
}

function MemoryCandidateCard({ candidate, t }: { candidate: MemoryCandidate; t: (key: TranslationKey) => string }) {
  return (
    <article className="workbench-card">
      <div className="card-icon"><Inbox size={16} /></div>
      <div>
        <div className="card-line"><strong>{t("memoryCandidateCreated")}</strong><RiskBadge risk={candidate.risk} t={t} /></div>
        <p>{candidate.label}</p>
        <small>{t("confidence")}: {candidate.confidence.toFixed(2)}</small>
      </div>
    </article>
  );
}

function TaskPanel({ tasks, onTaskStatus, t, locale }: { tasks: TaskItem[]; onTaskStatus: (task: TaskItem, status: TaskStatus) => void; t: (key: TranslationKey) => string; locale: UiLocale }) {
  return (
    <section className="panel feature-panel">
      <div className="panel-header">
        <h1>{t("tasks")}</h1>
        <span>{tasks.length}</span>
      </div>
      <div className="task-list">
        {tasks.length === 0 && <div className="empty-state">{t("noTasks")}</div>}
        {tasks.map((task) => (
          <TaskCard task={task} key={task.id} onTaskStatus={onTaskStatus} t={t} locale={locale} />
        ))}
      </div>
    </section>
  );
}

function TaskCard({ task, onTaskStatus, t, locale, compact = false }: { task: TaskItem; onTaskStatus: (task: TaskItem, status: TaskStatus) => void; t: (key: TranslationKey) => string; locale: UiLocale; compact?: boolean }) {
  return (
    <article className={`task-card ${compact ? "compact" : ""}`}>
      <div>
        <strong>{task.title}</strong>
        <span>{t("sourceRun")}: {task.sourceRunId} · {new Date(task.createdAt).toLocaleTimeString(locale)}</span>
      </div>
      <span className={`status-badge ${task.status}`}>{taskStatusLabel(task.status, t)}</span>
      <div className="row-actions">
        <button onClick={() => onTaskStatus(task, "accepted")} title={t("accept")}><Check size={15} /></button>
        <button onClick={() => onTaskStatus(task, "dismissed")} title={t("dismiss")}><X size={15} /></button>
        <button onClick={() => {
          const title = window.prompt(t("editTaskTitle"), task.title);
          if (title) {
            onTaskStatus({ ...task, title }, task.status);
          }
        }} title={t("edit")}><Pencil size={15} /></button>
      </div>
    </article>
  );
}

function AuditPanel({ audit, t, locale }: { audit: AuditRecord[]; t: (key: TranslationKey) => string; locale: UiLocale }) {
  return (
    <section className="panel activity-panel">
      <div className="panel-header">
        <h2>{t("navAudit")}</h2>
        <span>{audit.length} {t("auditRecords")}</span>
      </div>
      <div className="activity-list">
        {audit.length === 0 && <div className="empty-state">{t("noActivity")}</div>}
        {audit.slice(-40).reverse().map((record) => (
          <div className="activity-row" key={record.id}>
            <Database size={18} />
            <div><strong>{record.action}</strong><span>{record.targetType}: {record.targetId}</span></div>
            <small>{new Date(record.createdAt).toLocaleTimeString(locale)}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function SettingsPanel({
  settings,
  onChange,
  onSave,
  onCancel,
  providerPresets,
  providers,
  routes,
  providerDraft,
  onProviderDraftChange,
  onSaveProvider,
  onEditProvider,
  onDisableProvider,
  onTestProvider,
  onPatchRoute,
  testResult,
  mcpServers,
  tools,
  skills,
  mcpDraft,
  skillDraft,
  onMcpDraftChange,
  onSkillDraftChange,
  onSaveMcpServer,
  onEditMcpServer,
  onDisableMcpServer,
  onTestMcpServer,
  onRefreshMcpServer,
  onPatchTool,
  onTestTool,
  onSaveSkill,
  onToggleSkill,
  onTestSkill,
  t
}: {
  settings: LanguageSettings;
  onChange: (settings: LanguageSettings) => void;
  onSave: () => void;
  onCancel: () => void;
  providerPresets: LlmProviderPresetResponse[];
  providers: LlmProviderResponse[];
  routes: LlmModelRouteResponse[];
  providerDraft: ProviderDraft;
  onProviderDraftChange: (draft: ProviderDraft) => void;
  onSaveProvider: () => void;
  onEditProvider: (provider: LlmProviderResponse) => void;
  onDisableProvider: (provider: LlmProviderResponse) => void;
  onTestProvider: (provider: LlmProviderResponse) => void;
  onPatchRoute: (purpose: LlmRoutePurpose, patch: Partial<{
    provider_config_id: string;
    model: string;
    temperature: number;
    max_tokens: number;
    enabled: boolean;
  }>) => void;
  testResult: string;
  mcpServers: McpServerResponse[];
  tools: ToolRegistryResponse[];
  skills: SkillResponse[];
  mcpDraft: McpServerDraft;
  skillDraft: SkillDraft;
  onMcpDraftChange: (draft: McpServerDraft) => void;
  onSkillDraftChange: (draft: SkillDraft) => void;
  onSaveMcpServer: () => void;
  onEditMcpServer: (server: McpServerResponse) => void;
  onDisableMcpServer: (server: McpServerResponse) => void;
  onTestMcpServer: (server: McpServerResponse) => void;
  onRefreshMcpServer: (server: McpServerResponse) => void;
  onPatchTool: (tool: ToolRegistryResponse, patch: Partial<{
    risk_level: "low" | "medium" | "high";
    requires_confirmation: boolean;
    enabled: boolean;
  }>) => void;
  onTestTool: (tool: ToolRegistryResponse) => void;
  onSaveSkill: () => void;
  onToggleSkill: (skill: SkillResponse) => void;
  onTestSkill: (skill: SkillResponse) => void;
  t: (key: TranslationKey) => string;
}) {
  return (
    <section className="settings-panel">
      <div className="settings-section">
        <h2>{t("settings")}</h2>
        <div className="settings-copy">{t("settingsDescription")}</div>
        <label>
          <span>{t("interfaceLanguage")}</span>
          <select
            value={settings.uiLocale}
            onChange={(event) => onChange({ ...settings, uiLocale: event.target.value as UiLocale })}
          >
            <option value="en">{t("english")}</option>
            <option value="zh-CN">{t("simplifiedChinese")}</option>
          </select>
        </label>
        <label>
          <span>{t("assistantReplyLanguage")}</span>
          <select
            value={settings.assistantReplyLocale}
            onChange={(event) => onChange({ ...settings, assistantReplyLocale: event.target.value as AssistantReplyLocale })}
          >
            <option value="follow_ui">{assistantReplyLocaleLabel("follow_ui", t)}</option>
            <option value="en">{assistantReplyLocaleLabel("en", t)}</option>
            <option value="zh-CN">{assistantReplyLocaleLabel("zh-CN", t)}</option>
          </select>
        </label>
        <div className="settings-actions">
          <button className="ghost-button" onClick={onCancel}>{t("cancel")}</button>
          <button className="primary-button" onClick={() => void onSave()}>{t("save")}</button>
        </div>
      </div>

      <div className="settings-section llm-settings">
        <h2>{t("llmConfiguration")}</h2>
        <div className="settings-copy">{t("llmPrivacyNote")}</div>

        <div className="provider-editor">
          <label>
            <span>{t("providerPreset")}</span>
            <select
              value={providerDraft.presetId ?? ""}
              onChange={(event) => {
                const preset = providerPresets.find((item) => item.id === event.target.value);
                onProviderDraftChange(preset ? {
                  ...providerDraft,
                  presetId: preset.id,
                  displayName: preset.display_name,
                  adapterType: preset.adapter_type,
                  baseUrl: preset.base_url ?? "",
                  defaultModel: preset.default_model
                } : { ...providerDraft, presetId: undefined });
              }}
            >
              <option value="">{t("addProvider")}</option>
              {providerPresets.map((preset) => (
                <option value={preset.id} key={preset.id}>{preset.display_name}</option>
              ))}
            </select>
          </label>
          <label>
            <span>{t("displayName")}</span>
            <input value={providerDraft.displayName} onChange={(event) => onProviderDraftChange({ ...providerDraft, displayName: event.target.value })} />
          </label>
          <label>
            <span>{t("adapterType")}</span>
            <select value={providerDraft.adapterType} onChange={(event) => onProviderDraftChange({ ...providerDraft, adapterType: event.target.value as LlmAdapterType })}>
              <option value="mock">mock</option>
              <option value="openai-compatible">openai-compatible</option>
              <option value="openai-native">openai-native</option>
              <option value="anthropic">anthropic</option>
              <option value="gemini">gemini</option>
            </select>
          </label>
          <label>
            <span>{t("baseUrl")}</span>
            <input value={providerDraft.baseUrl} onChange={(event) => onProviderDraftChange({ ...providerDraft, baseUrl: event.target.value })} />
          </label>
          <label>
            <span>{t("apiKey")}</span>
            <input type="password" placeholder={t("apiKeyPlaceholder")} value={providerDraft.apiKey} onChange={(event) => onProviderDraftChange({ ...providerDraft, apiKey: event.target.value })} />
          </label>
          <label>
            <span>{t("defaultModel")}</span>
            <input value={providerDraft.defaultModel} onChange={(event) => onProviderDraftChange({ ...providerDraft, defaultModel: event.target.value })} />
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={providerDraft.enabled} onChange={(event) => onProviderDraftChange({ ...providerDraft, enabled: event.target.checked })} />
            <span>{t("enabled")}</span>
          </label>
          <div className="settings-actions">
            <button className="ghost-button" onClick={() => onProviderDraftChange(emptyProviderDraft())}>{t("cancel")}</button>
            <button className="primary-button" onClick={() => void onSaveProvider()}>{providerDraft.id ? t("save") : t("addProvider")}</button>
          </div>
        </div>

        <h3>{t("providers")}</h3>
        <div className="provider-list">
          {providers.length === 0 && <div className="empty-state">{t("noProviders")}</div>}
          {providers.map((provider) => (
            <div className="provider-row" key={provider.id}>
              <div>
                <strong>{provider.display_name}</strong>
                <span>{provider.adapter_type} · {provider.default_model} · {provider.has_api_key ? t("hasApiKey") : t("apiKey")}</span>
              </div>
              <span className={`status-badge ${provider.enabled ? "active" : "rejected"}`}>{provider.enabled ? t("enabled") : t("disabled")}</span>
              <div className="row-actions">
                <button onClick={() => onEditProvider(provider)} title={t("edit")}><Pencil size={15} /></button>
                <button onClick={() => void onTestProvider(provider)} title={t("testConnection")}><Check size={15} /></button>
                <button onClick={() => void onDisableProvider(provider)} title={t("disable")}><X size={15} /></button>
              </div>
            </div>
          ))}
        </div>
        {testResult && <div className="settings-copy">{testResult}</div>}

        <h3>{t("modelRoutes")}</h3>
        <div className="route-list">
          {routes.map((route) => (
            <div className="route-row" key={route.purpose}>
              <strong>{routePurposeLabel(route.purpose, t)}</strong>
              <select
                value={route.provider_config_id}
                onChange={(event) => {
                  const provider = providers.find((item) => item.id === event.target.value);
                  void onPatchRoute(route.purpose, {
                    provider_config_id: event.target.value,
                    model: provider?.default_model
                  });
                }}
              >
                {providers.map((provider) => (
                  <option value={provider.id} key={provider.id}>{provider.display_name}</option>
                ))}
              </select>
              <input value={route.model} onChange={(event) => void onPatchRoute(route.purpose, { model: event.target.value })} />
              <input type="number" min="0" max="2" step="0.1" value={route.temperature} onChange={(event) => void onPatchRoute(route.purpose, { temperature: Number(event.target.value) })} />
              <input type="number" min="1" value={route.max_tokens} onChange={(event) => void onPatchRoute(route.purpose, { max_tokens: Number(event.target.value) })} />
              <label className="route-enabled"><input type="checkbox" checked={route.enabled} onChange={(event) => void onPatchRoute(route.purpose, { enabled: event.target.checked })} /> {t("enabled")}</label>
            </div>
          ))}
        </div>
      </div>

      <McpSettingsSection
        servers={mcpServers}
        draft={mcpDraft}
        onDraftChange={onMcpDraftChange}
        onSave={onSaveMcpServer}
        onEdit={onEditMcpServer}
        onDisable={onDisableMcpServer}
        onTest={onTestMcpServer}
        onRefresh={onRefreshMcpServer}
        t={t}
      />

      <ToolRegistrySection
        tools={tools}
        onPatchTool={onPatchTool}
        onTestTool={onTestTool}
        t={t}
      />

      <SkillsSection
        skills={skills}
        draft={skillDraft}
        onDraftChange={onSkillDraftChange}
        onSave={onSaveSkill}
        onToggle={onToggleSkill}
        onTest={onTestSkill}
        t={t}
      />
    </section>
  );
}

function McpSettingsSection({
  servers,
  draft,
  onDraftChange,
  onSave,
  onEdit,
  onDisable,
  onTest,
  onRefresh,
  t
}: {
  servers: McpServerResponse[];
  draft: McpServerDraft;
  onDraftChange: (draft: McpServerDraft) => void;
  onSave: () => void;
  onEdit: (server: McpServerResponse) => void;
  onDisable: (server: McpServerResponse) => void;
  onTest: (server: McpServerResponse) => void;
  onRefresh: (server: McpServerResponse) => void;
  t: (key: TranslationKey) => string;
}) {
  return (
    <div className="settings-section llm-settings">
      <h2>{t("mcpServers")}</h2>
      <div className="settings-copy">{t("mcpSafetyNote")}</div>
      <div className="provider-editor">
        <label>
          <span>{t("displayName")}</span>
          <input value={draft.name} onChange={(event) => onDraftChange({ ...draft, name: event.target.value })} />
        </label>
        <label>
          <span>{t("transport")}</span>
          <select value={draft.transport} onChange={(event) => onDraftChange({ ...draft, transport: event.target.value as McpServerDraft["transport"] })}>
            <option value="stdio">stdio</option>
            <option value="streamable_http">streamable_http</option>
          </select>
        </label>
        <label>
          <span>{t("command")}</span>
          <input value={draft.command} onChange={(event) => onDraftChange({ ...draft, command: event.target.value })} />
        </label>
        <label>
          <span>{t("arguments")}</span>
          <input value={draft.args} onChange={(event) => onDraftChange({ ...draft, args: event.target.value })} />
        </label>
        <label>
          <span>{t("url")}</span>
          <input value={draft.url} onChange={(event) => onDraftChange({ ...draft, url: event.target.value })} />
        </label>
        <label>
          <span>{t("headersJson")}</span>
          <input value={draft.headers} placeholder='{"Authorization":"Bearer ..."}' onChange={(event) => onDraftChange({ ...draft, headers: event.target.value })} />
        </label>
        <label>
          <span>{t("trustLevel")}</span>
          <select value={draft.trustLevel} onChange={(event) => onDraftChange({ ...draft, trustLevel: event.target.value as McpServerDraft["trustLevel"] })}>
            <option value="untrusted">{t("untrusted")}</option>
            <option value="trusted">{t("trusted")}</option>
            <option value="first_party">{t("firstParty")}</option>
          </select>
        </label>
        <label className="checkbox-row">
          <input type="checkbox" checked={draft.enabled} onChange={(event) => onDraftChange({ ...draft, enabled: event.target.checked })} />
          <span>{t("enabled")}</span>
        </label>
        <div className="settings-actions">
          <button className="ghost-button" onClick={() => onDraftChange(emptyMcpDraft())}>{t("cancel")}</button>
          <button className="primary-button" onClick={() => void onSave()}>{draft.id ? t("save") : t("addMcpServer")}</button>
        </div>
      </div>
      <div className="provider-list">
        {servers.length === 0 && <div className="empty-state">{t("noMcpServers")}</div>}
        {servers.map((server) => (
          <div className="provider-row mcp-row" key={server.id}>
            <div>
              <strong>{server.name}</strong>
              <span>{server.transport} · {server.status} · {server.trust_level} · {server.has_headers ? t("headersConfigured") : t("noHeaders")}</span>
            </div>
            <span className={`status-badge ${server.enabled ? "active" : "rejected"}`}>{server.enabled ? t("enabled") : t("disabled")}</span>
            <div className="row-actions">
              <button onClick={() => onEdit(server)} title={t("edit")}><Pencil size={15} /></button>
              <button onClick={() => void onTest(server)} title={t("testConnection")}><Check size={15} /></button>
              <button onClick={() => void onRefresh(server)} title={t("refreshTools")}><Activity size={15} /></button>
              <button onClick={() => void onDisable(server)} title={t("disable")}><X size={15} /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ToolRegistrySection({ tools, onPatchTool, onTestTool, t }: {
  tools: ToolRegistryResponse[];
  onPatchTool: (tool: ToolRegistryResponse, patch: Partial<{ risk_level: "low" | "medium" | "high"; requires_confirmation: boolean; enabled: boolean }>) => void;
  onTestTool: (tool: ToolRegistryResponse) => void;
  t: (key: TranslationKey) => string;
}) {
  return (
    <div className="settings-section">
      <h2>{t("toolRegistry")}</h2>
      <div className="tool-grid">
        {tools.length === 0 && <div className="empty-state">{t("noTools")}</div>}
        {tools.map((tool) => (
          <div className="tool-row" key={tool.id}>
            <div>
              <strong>{tool.title}</strong>
              <span>{tool.source} · {tool.name}</span>
              <small>{tool.description}</small>
            </div>
            <select value={tool.risk_level} onChange={(event) => void onPatchTool(tool, { risk_level: event.target.value as "low" | "medium" | "high" })}>
              <option value="low">{t("low")}</option>
              <option value="medium">{t("medium")}</option>
              <option value="high">{t("high")}</option>
            </select>
            <label className="route-enabled"><input type="checkbox" checked={tool.requires_confirmation} onChange={(event) => void onPatchTool(tool, { requires_confirmation: event.target.checked })} /> {t("requiresConfirmation")}</label>
            <label className="route-enabled"><input type="checkbox" checked={tool.enabled} onChange={(event) => void onPatchTool(tool, { enabled: event.target.checked })} /> {t("enabled")}</label>
            <button className="ghost-button" onClick={() => void onTestTool(tool)}>{t("testRun")}</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function SkillsSection({ skills, draft, onDraftChange, onSave, onToggle, onTest, t }: {
  skills: SkillResponse[];
  draft: SkillDraft;
  onDraftChange: (draft: SkillDraft) => void;
  onSave: () => void;
  onToggle: (skill: SkillResponse) => void;
  onTest: (skill: SkillResponse) => void;
  t: (key: TranslationKey) => string;
}) {
  return (
    <div className="settings-section">
      <h2>{t("skills")}</h2>
      <div className="provider-editor skill-editor">
        <label>
          <span>{t("name")}</span>
          <input value={draft.name} onChange={(event) => onDraftChange({ ...draft, name: event.target.value })} />
        </label>
        <label>
          <span>{t("description")}</span>
          <input value={draft.description} onChange={(event) => onDraftChange({ ...draft, description: event.target.value })} />
        </label>
        <label>
          <span>{t("requiredTools")}</span>
          <input value={draft.requiredTools} onChange={(event) => onDraftChange({ ...draft, requiredTools: event.target.value })} />
        </label>
        <label>
          <span>{t("risk")}</span>
          <select value={draft.riskLevel} onChange={(event) => onDraftChange({ ...draft, riskLevel: event.target.value as "low" | "medium" | "high" })}>
            <option value="low">{t("low")}</option>
            <option value="medium">{t("medium")}</option>
            <option value="high">{t("high")}</option>
          </select>
        </label>
        <label className="skill-markdown">
          <span>{t("instructions")}</span>
          <textarea value={draft.instructionMarkdown} onChange={(event) => onDraftChange({ ...draft, instructionMarkdown: event.target.value })} />
        </label>
        <div className="settings-actions">
          <button className="ghost-button" onClick={() => onDraftChange(emptySkillDraft())}>{t("cancel")}</button>
          <button className="primary-button" onClick={() => void onSave()}>{t("addSkill")}</button>
        </div>
      </div>
      <div className="skill-list">
        {skills.map((skill) => (
          <details className="skill-row" key={skill.id}>
            <summary>
              <div>
                <strong>{skill.name}</strong>
                <span>{skill.source_type} · {skill.required_tools.join(", ") || t("noRequiredTools")}</span>
              </div>
              <RiskBadge risk={skill.risk_level} t={t} />
              <span className={`status-badge ${skill.enabled ? "active" : "rejected"}`}>{skill.enabled ? t("enabled") : t("disabled")}</span>
            </summary>
            <p>{skill.description}</p>
            <pre>{skill.instruction_markdown}</pre>
            <div className="inline-actions">
              <button onClick={() => void onToggle(skill)}>{skill.enabled ? t("disable") : t("enable")}</button>
              <button onClick={() => void onTest(skill)}>{t("testRun")}</button>
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

function readCachedLocale(): UiLocale {
  if (typeof localStorage === "undefined") {
    return "en";
  }
  return localStorage.getItem("sedna.ui_locale") === "zh-CN" ? "zh-CN" : "en";
}

function emptyProviderDraft(): ProviderDraft {
  return {
    displayName: "Mock",
    adapterType: "mock",
    baseUrl: "",
    apiKey: "",
    defaultModel: "mock-deterministic",
    enabled: true
  };
}

function emptyMcpDraft(): McpServerDraft {
  return {
    name: "Mock stdio MCP",
    transport: "stdio",
    command: "mock-stdio",
    args: "",
    url: "",
    headers: "",
    enabled: true,
    trustLevel: "untrusted"
  };
}

function emptySkillDraft(): SkillDraft {
  return {
    name: "local-planning",
    description: "Local planning workflow for owner-approved tasks.",
    instructionMarkdown: "# Instructions\nPlan safe internal next actions.\n\n# Verification\nReturn an audit-safe summary.",
    requiredTools: "task.create,suggest_action",
    riskLevel: "low",
    enabled: true
  };
}

function parseHeaderDraft(value: string): Record<string, string> {
  if (!value.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter(([, entry]) => typeof entry === "string")) as Record<string, string>;
  } catch {
    return {};
  }
}

function routePurposeLabel(purpose: LlmRoutePurpose, t: (key: TranslationKey) => string): string {
  switch (purpose) {
    case "chat_reply":
      return t("chatReply");
    case "memory_extraction":
      return t("memoryExtraction");
    case "summarization":
      return t("summarization");
    case "classification":
      return t("classification");
  }
}

function createAgentRun(content: string, now: string, t: (key: TranslationKey) => string): AgentRun {
  const id = `run_${Date.now()}`;
  return {
    id,
    status: "running",
    title: t("ownerRequestRun"),
    sourceMessage: content,
    startedAt: now,
    steps: [
      {
        id: `${id}_step_1`,
        index: 1,
        status: "running",
        thoughtSummary: t("safePlanningSummary"),
        action: {
          type: shouldCreateTask(content) ? "task.create_suggestion" : "conversation.reply",
          risk: shouldRequireConfirmation(content) ? "medium" : "low",
          requiresConfirmation: shouldRequireConfirmation(content),
          payload: {
            user_request: content,
            mode: "brain_internal",
            external_execution: false
          }
        },
        policy: {
          result: shouldRequireConfirmation(content) ? "needs_confirmation" : "allowed",
          reason: shouldRequireConfirmation(content) ? t("policyNeedsConfirmation") : t("policyInternalOnly")
        },
        observationSummary: t("waitingForProvider")
      }
    ]
  };
}

function markRunWaiting(run: AgentRun, t: (key: TranslationKey) => string): AgentRun {
  return {
    ...run,
    status: "waiting_confirmation",
    steps: updateStep(run.steps, 0, {
      status: "waiting_confirmation",
      observationSummary: t("waitingForOwnerConfirmation")
    })
  };
}

function createConfirmationForRun(run: AgentRun, now: string, t: (key: TranslationKey) => string): ConfirmationItem {
  const step = run.steps[0];
  return {
    id: `${run.id}_confirmation`,
    runId: run.id,
    stepId: step.id,
    title: t("confirmActionReview"),
    actionType: step.action.type,
    risk: step.action.risk === "high" ? "high" : "medium",
    payload: step.action.payload,
    status: "pending",
    createdAt: now
  };
}

function createTaskFromRequest(content: string, run: AgentRun, now: string, t: (key: TranslationKey) => string): TaskItem {
  return {
    id: `${run.id}_task`,
    title: content.length > 42 ? `${content.slice(0, 42)}...` : content || t("suggestedTask"),
    status: "suggested",
    sourceRunId: run.id,
    sourceStepId: run.steps[0].id,
    createdAt: now
  };
}

function shouldCreateTask(content: string): boolean {
  return /(task|todo|next|plan|整理|待办|任务|接下来|计划|安排)/i.test(content);
}

function shouldRequireConfirmation(content: string): boolean {
  return /(send|delete|publish|commit|pay|execute|email|发送|删除|发布|提交|付款|执行|邮件|外部)/i.test(content);
}

function updateStep(steps: AgentStep[], stepIndex: number, patch: Partial<AgentStep>): AgentStep[] {
  return steps.map((step, index) => index === stepIndex ? { ...step, ...patch } : step);
}

function addOrUpdateMemoryStep(run: AgentRun, t: (key: TranslationKey) => string, count?: number): AgentRun {
  const existingIndex = run.steps.findIndex((step) => step.action.type === "memory.extract_candidates");
  const observationSummary = count === undefined ? t("extractingMemory") : `${t("memoryCandidatesFound")}: ${count}`;
  const step: AgentStep = {
    id: `${run.id}_step_memory`,
    index: run.steps.length + 1,
    status: count === undefined ? "running" : "completed",
    thoughtSummary: t("memoryExtractionSummary"),
    action: {
      type: "memory.extract_candidates",
      risk: "low",
      requiresConfirmation: false,
      payload: {
        evidence_quote_policy: "preserve_original_language",
        writes_active_memory: false
      }
    },
    policy: {
      result: "allowed",
      reason: t("policyMemoryCandidateOnly")
    },
    observationSummary
  };
  if (existingIndex >= 0) {
    return {
      ...run,
      steps: run.steps.map((item, index) => index === existingIndex ? { ...item, status: step.status, observationSummary } : item)
    };
  }
  return { ...run, steps: [...run.steps, step] };
}

function RunStatusBadge({ status, t }: { status: AgentRunStatus; t: (key: TranslationKey) => string }) {
  return <span className={`run-status ${status}`}>{runStatusLabel(status, t)}</span>;
}

function StepStatusBadge({ status, t }: { status: AgentStepStatus; t: (key: TranslationKey) => string }) {
  return <span className={`status-badge ${status}`}>{stepStatusLabel(status, t)}</span>;
}

function statusLabel(status: string, t: (key: TranslationKey) => string): string {
  const key = status as TranslationKey;
  if (["candidate", "active", "rejected", "quarantined", "observed", "superseded", "expired"].includes(status)) {
    return t(key);
  }
  return status;
}

function sourceLabel(candidate: MemoryCandidate): string {
  const sourceRunId = typeof candidate.payload.sourceRunId === "string" ? candidate.payload.sourceRunId : undefined;
  const sourceStepId = typeof candidate.payload.sourceStepId === "string" ? candidate.payload.sourceStepId : undefined;
  return [sourceRunId, sourceStepId, candidate.sourceMessageId].filter(Boolean).join(" / ") || "message";
}

function runStatusLabel(status: AgentRunStatus, t: (key: TranslationKey) => string): string {
  switch (status) {
    case "running":
      return t("running");
    case "waiting_confirmation":
      return t("waitingConfirmation");
    case "completed":
      return t("completed");
    case "failed":
      return t("failed");
  }
}

function stepStatusLabel(status: AgentStepStatus, t: (key: TranslationKey) => string): string {
  switch (status) {
    case "pending":
      return t("pending");
    case "running":
      return t("running");
    case "waiting_confirmation":
      return t("waitingConfirmation");
    case "completed":
      return t("completed");
    case "failed":
      return t("failed");
  }
}

function confirmationStatusLabel(status: ConfirmationStatus, t: (key: TranslationKey) => string): string {
  switch (status) {
    case "pending":
      return t("pending");
    case "approved":
      return t("approved");
    case "rejected":
      return t("rejected");
  }
}

function taskStatusLabel(status: TaskStatus, t: (key: TranslationKey) => string): string {
  switch (status) {
    case "suggested":
      return t("suggested");
    case "accepted":
      return t("accepted");
    case "dismissed":
      return t("dismissed");
  }
}

function policyResultLabel(status: PolicyResultStatus, t: (key: TranslationKey) => string): string {
  switch (status) {
    case "allowed":
      return t("allowed");
    case "needs_confirmation":
      return t("needsConfirmation");
    case "blocked":
      return t("blocked");
  }
}

function riskLabel(risk: string, t: (key: TranslationKey) => string): string {
  if (risk === "low" || risk === "medium" || risk === "high") {
    return t(risk);
  }
  return risk;
}

function eventLabel(event: Event, t: (key: TranslationKey) => string): string {
  switch (event.type) {
    case "message.created":
      return t("chatTimeline");
    case "memory.candidate_created":
      return t("candidate");
    case "memory.promoted":
      return t("active");
    case "memory.rejected":
      return t("rejected");
    case "memory.quarantined":
      return t("quarantined");
    case "settings.updated":
      return t("settingsSaved");
    case "worker.registered":
      return t("mockWorker");
    default:
      return event.title;
  }
}

function toFlow(graph: GraphResponse): { nodes: Node[]; edges: Edge[] } {
  const radius = 155;
  const nodes = graph.nodes.map((node, index) => {
    const angle = (index / Math.max(graph.nodes.length, 1)) * Math.PI * 2;
    return {
      id: node.id,
      position: index === 0 ? { x: 240, y: 150 } : { x: 240 + Math.cos(angle) * radius, y: 150 + Math.sin(angle) * radius },
      data: { label: node.label },
      className: `flow-node ${node.type}`
    };
  });
  const edges = graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.sourceNodeId,
    target: edge.targetNodeId,
    label: edge.relation,
    animated: false
  }));
  return { nodes, edges };
}
