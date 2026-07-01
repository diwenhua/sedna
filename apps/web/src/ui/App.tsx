import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  Trash2,
  UserRound,
  X
} from "lucide-react";
import { Background, Controls, ReactFlow, type Edge, type Node } from "@xyflow/react";
import type {
  AssistantReplyLocale,
  AuditRecord,
  Capability,
  Conversation,
  Evidence,
  Event,
  GraphResponse,
  LlmAdapterType,
  LlmRoutePurpose,
  MemoryCandidate,
  Message,
  RiskLevel,
  UiLocale,
  Worker,
  WorkerJob,
  WorkerPathScope
} from "@sedna/protocol";
import {
  approveCandidate,
  createWorkerPairCode,
  createWorkerPathScope,
  createLlmProvider,
  createMcpServer,
  createConversation,
  deleteConversation,
  deleteSkill,
  deleteWorkerPathScope,
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
  getWebToolsSettings,
  getWorkerDetail,
  getWorkers,
  patchMcpServer,
  patchLlmProvider,
  patchLlmRoute,
  patchSettings,
  patchWorkerCapability,
  patchWorkerPathScope,
  patchWebToolsSettings,
  patchSkill,
  patchToolPolicy,
  rejectCandidate,
  renameConversation,
  refreshMcpServer,
  revokeWorker,
  sendMessageStream,
  testMcpServer,
  testLlmProvider,
  uploadSkillsZip,
  testTool,
  testWebToolsSettings,
  type LlmModelRouteResponse,
  type LlmProviderPresetResponse,
  type LlmProviderResponse,
  type McpServerResponse,
  type SkillResponse,
  type ToolRegistryResponse,
  type WebToolsSettingsResponse,
  type WorkerDetailResponse
} from "../api.js";
import { assistantReplyLocaleLabel, createTranslator, type TranslationKey } from "../i18n/index.js";
import { MessageMarkdown } from "./MessageMarkdown.js";

type MainTab = "chat" | "memory" | "tasks" | "graph" | "workers" | "activity" | "audit" | "settings";
type AgentRunStatus = "running" | "waiting_confirmation" | "completed" | "failed";
type AgentStepStatus = "pending" | "running" | "waiting_confirmation" | "completed" | "failed";
type PolicyResultStatus = "allowed" | "needs_confirmation" | "blocked";
type TaskStatus = "suggested" | "accepted" | "dismissed";
type ConfirmationStatus = "pending" | "approved" | "rejected";

interface AppRoute {
  tab: MainTab;
  conversationId?: string;
}

interface LanguageSettings {
  uiLocale: UiLocale;
  assistantReplyLocale: AssistantReplyLocale;
}

interface WebToolsDraft {
  enabled: boolean;
  searchProvider: WebToolsSettingsResponse["search_provider"];
  searchMaxResults: number;
  fetchMaxChars: number;
  fetchTimeoutMs: number;
  searxngUrl: string;
  braveApiKey: string;
  dashscopeApiKey: string;
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

export function App() {
  const initialRoute = useMemo(() => readRoute(), []);
  const [conversationId, setConversationId] = useState<string>();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatActivities, setChatActivities] = useState<ChatActivity[]>([]);
  const [chatRunInProgress, setChatRunInProgress] = useState(false);
  const [agentRuns, setAgentRuns] = useState<AgentRun[]>([]);
  const [confirmations, setConfirmations] = useState<ConfirmationItem[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [timeline, setTimeline] = useState<Array<Event | Message>>([]);
  const [candidates, setCandidates] = useState<MemoryCandidate[]>([]);
  const [graph, setGraph] = useState<GraphResponse>({ nodes: [], edges: [], evidence: [] });
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [workerDetails, setWorkerDetails] = useState<WorkerDetailResponse[]>([]);
  const [workerPairCode, setWorkerPairCode] = useState<string>("");
  const [audit, setAudit] = useState<AuditRecord[]>([]);
  const [activeTab, setActiveTab] = useState<MainTab>(initialRoute.tab);
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
  const [testResult, setTestResult] = useState<string>("");
  const [webToolsSettings, setWebToolsSettings] = useState<WebToolsSettingsResponse | null>(null);
  const [webToolsDraft, setWebToolsDraft] = useState<WebToolsDraft>(emptyWebToolsDraft());
  const [webToolsTestResult, setWebToolsTestResult] = useState<string>("");
  const t = useMemo(() => createTranslator(settings.uiLocale), [settings.uiLocale]);
  const onlineWorkerCount = workers.filter((worker) => worker.status === "online").length;

  const refreshWorkers = useCallback(async () => {
    const nextWorkers = (await getWorkers()).filter((worker) => worker.status !== "revoked");
    setWorkers(nextWorkers);
    const nextDetails = await Promise.all(nextWorkers.map((worker) => getWorkerDetail(worker.id)));
    setWorkerDetails(nextDetails.sort((a, b) => {
      if (a.worker.status === b.worker.status) {
        return a.worker.displayName.localeCompare(b.worker.displayName);
      }
      return a.worker.status === "online" ? -1 : 1;
    }));
  }, []);

  const refresh = useCallback(async (id = conversationId, view = graphView) => {
    const [nextConversations, nextTimeline, nextCandidates, nextGraph, nextWorkers, nextAudit] = await Promise.all([
      getConversations(),
      getTimeline(),
      getCandidates(),
      getGraph(view),
      getWorkers(),
      getAudit()
    ]);
    setConversations(nextConversations);
    setTimeline(nextTimeline);
    setCandidates(nextCandidates);
    setGraph(nextGraph);
    const activeWorkers = nextWorkers.filter((worker) => worker.status !== "revoked");
    setWorkers(activeWorkers);
    const nextWorkerDetails = await Promise.all(activeWorkers.map((worker) => getWorkerDetail(worker.id)));
    setWorkerDetails(nextWorkerDetails.sort((a, b) => {
      if (a.worker.status === b.worker.status) {
        return a.worker.displayName.localeCompare(b.worker.displayName);
      }
      return a.worker.status === "online" ? -1 : 1;
    }));
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
    const [servers, registryTools, skillList, webTools] = await Promise.all([
      getMcpServers(),
      getTools(),
      getSkills(),
      getWebToolsSettings()
    ]);
    setMcpServers(servers);
    setTools(registryTools);
    setSkills(skillList);
    setWebToolsSettings(webTools);
    setWebToolsDraft(toWebToolsDraft(webTools));
  }, []);

  useEffect(() => {
    async function boot() {
      try {
        setStatus(t("connecting"));
        const route = readRoute();
        setActiveTab(route.tab);
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
        let conversation = route.conversationId ? existing.find((item) => item.id === route.conversationId) : undefined;
        conversation ??= existing[0] ?? await createConversation(createTranslator(nextSettings.uiLocale)("newConversation"));
        const nextConversations = existing.some((item) => item.id === conversation.id) ? existing : [conversation, ...existing];
        setConversations(nextConversations);
        setConversationId(conversation.id);
        const fullConversation = await getConversation(conversation.id);
        setMessages(fullConversation.messages);
        writeRoute({ tab: route.tab, conversationId: route.tab === "chat" ? conversation.id : undefined }, "replace");
        await refresh(conversation.id);
        setStatus(createTranslator(nextSettings.uiLocale)("selfHosted"));
      } catch (error) {
        setStatus(error instanceof Error ? error.message : t("brainUnavailable"));
      }
    }
    void boot();
  }, []);

  useEffect(() => {
    function handlePopState() {
      const route = readRoute();
      setActiveTab(route.tab);
      if (route.conversationId) {
        void openConversation(route.conversationId, "replace");
      }
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refreshWorkers();
    }, 5000);
    return () => window.clearInterval(interval);
  }, [refreshWorkers]);

  function navigateToTab(tab: MainTab) {
    setActiveTab(tab);
    writeRoute({ tab, conversationId: tab === "chat" ? conversationId : undefined });
  }

  async function openConversation(id: string, routeMode: "push" | "replace" = "push") {
    setConversationId(id);
    setActiveTab("chat");
    setChatRunInProgress(false);
    setChatActivities([]);
    writeRoute({ tab: "chat", conversationId: id }, routeMode);
    const conversation = await getConversation(id);
    setMessages(conversation.messages);
  }

  async function handleNewConversation() {
    const conversation = await createConversation(t("newConversation"));
    setConversations((current) => [conversation, ...current]);
    setMessages([]);
    setChatActivities([]);
    await openConversation(conversation.id);
  }

  async function handleRenameConversation(conversation: Conversation) {
    const title = window.prompt(t("renameConversation"), conversation.title)?.trim();
    if (!title || title === conversation.title) {
      return;
    }
    const renamed = await renameConversation(conversation.id, title);
    setConversations((current) => current.map((item) => item.id === renamed.id ? renamed : item));
    setStatus(t("conversationRenamed"));
  }

  async function handleDeleteConversation(conversation: Conversation) {
    if (!window.confirm(t("confirmDeleteConversation"))) {
      return;
    }
    await deleteConversation(conversation.id);
    const remaining = conversations.filter((item) => item.id !== conversation.id);
    const nextConversation = remaining[0] ?? await createConversation(t("newConversation"));
    const nextConversations = remaining.length > 0 ? remaining : [nextConversation];
    setConversations(nextConversations);
    setStatus(t("conversationDeleted"));
    if (conversation.id === conversationId) {
      await openConversation(nextConversation.id, "replace");
    }
  }

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
    setChatActivities([]);
    setChatRunInProgress(true);
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
          if (shouldShowAssistantStatus(event.payload.phase)) {
            setChatActivities((current) => [...current, {
              id: `${event.payload.phase}_${Date.now()}`,
              title: event.payload.title
            }]);
          }
          if (event.payload.phase === "memory_extraction") {
            updateAgentRun(run.id, (currentRun) => addOrUpdateMemoryStep(currentRun, t));
          }
        }
        if (event.type === "tool_status") {
          const title = buildToolActivityTitle(t, event.payload.tool, event.payload.phase, {
            query: event.payload.query,
            url: event.payload.url,
            fallbackTitle: event.payload.title
          });
          setChatActivities((current) => [...current, { id: `tool_${event.payload.tool}_${Date.now()}`, title }]);
          updateAgentRun(run.id, (currentRun) => ({
            ...currentRun,
            steps: updateStep(currentRun.steps, 0, {
              status: "running",
              observationSummary: title
            })
          }));
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
              ? {
                  ...event.payload.message,
                  content: event.payload.message.content || message.content,
                  metadata: { ...event.payload.message.metadata, pending: false }
                }
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
        if (event.type === "profile_attributes") {
          void getGraph(graphView).then(setGraph);
        }
        if (event.type === "error") {
          setStatus(`${t("messageFailed")}: ${event.payload.message}`);
          setChatRunInProgress(false);
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
          setChatRunInProgress(false);
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
      setChatRunInProgress(false);
      setStatus(t("selfHosted"));
    } catch (error) {
      setStatus(error instanceof Error ? `${t("messageFailed")}: ${error.message}` : t("messageFailed"));
      setChatRunInProgress(false);
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

  async function handleCreateWorkerPairCode() {
    const pairCode = await createWorkerPairCode();
    setWorkerPairCode(pairCode.code ?? "");
  }

  async function handleRevokeWorker(worker: Worker) {
    if (!window.confirm(t("confirmRevokeWorker"))) {
      return;
    }
    try {
      await revokeWorker(worker.id);
      setWorkers((current) => current.filter((item) => item.id !== worker.id));
      setWorkerDetails((current) => current.filter((item) => item.worker.id !== worker.id));
      setGraph(await getGraph(graphView));
      setStatus(t("workerRevoked"));
      void refreshWorkers();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t("workerRevokeFailed"));
    }
  }

  async function handlePatchWorkerCapability(
    workerId: string,
    capability: Capability,
    patch: Partial<{ enabled: boolean; risk: RiskLevel; requires_confirmation: boolean }>
  ) {
    try {
      const updated = await patchWorkerCapability(workerId, capability.id, patch);
      setWorkerDetails((current) => current.map((detail) => detail.worker.id === workerId ? {
        ...detail,
        capabilities: detail.capabilities.map((item) => item.id === updated.id ? updated : item)
      } : detail));
      setStatus(t("workerPolicySaved"));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t("workerPolicySaveFailed"));
    }
  }

  async function handleCreateWorkerPathScope(workerId: string, input: { label: string; path: string }) {
    try {
      const scope = await createWorkerPathScope(workerId, {
        label: input.label,
        path: input.path,
        mode: "read_only",
        enabled: true
      });
      setWorkerDetails((current) => current.map((detail) => detail.worker.id === workerId ? {
        ...detail,
        pathScopes: [...detail.pathScopes, scope]
      } : detail));
      setStatus(t("workerPolicySaved"));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t("workerPolicySaveFailed"));
    }
  }

  async function handlePatchWorkerPathScope(
    workerId: string,
    scope: WorkerPathScope,
    patch: Partial<{ label: string; path: string; enabled: boolean }>
  ) {
    try {
      const updated = await patchWorkerPathScope(workerId, scope.id, patch);
      setWorkerDetails((current) => current.map((detail) => detail.worker.id === workerId ? {
        ...detail,
        pathScopes: detail.pathScopes.map((item) => item.id === updated.id ? updated : item)
      } : detail));
      setStatus(t("workerPolicySaved"));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t("workerPolicySaveFailed"));
    }
  }

  async function handleDeleteWorkerPathScope(workerId: string, scope: WorkerPathScope) {
    if (!window.confirm(t("confirmDeleteWorkerPathScope"))) {
      return;
    }
    try {
      await deleteWorkerPathScope(workerId, scope.id);
      setWorkerDetails((current) => current.map((detail) => detail.worker.id === workerId ? {
        ...detail,
        pathScopes: detail.pathScopes.filter((item) => item.id !== scope.id)
      } : detail));
      setStatus(t("workerPolicySaved"));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t("workerPolicySaveFailed"));
    }
  }

  async function handleEdit(candidate: MemoryCandidate) {
    const label = window.prompt(t("editMemoryLabel"), candidate.label);
    if (!label || label === candidate.label) {
      return;
    }
    await editCandidate(candidate.id, label);
    await refresh();
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

  async function handleSaveWebTools() {
    try {
      const next = await patchWebToolsSettings({
        enabled: webToolsDraft.enabled,
        search_provider: webToolsDraft.searchProvider,
        search_max_results: webToolsDraft.searchMaxResults,
        fetch_max_chars: webToolsDraft.fetchMaxChars,
        fetch_timeout_ms: webToolsDraft.fetchTimeoutMs,
        searxng_url: webToolsDraft.searxngUrl.trim().length > 0 ? webToolsDraft.searxngUrl.trim() : null,
        brave_api_key: webToolsDraft.braveApiKey.trim().length > 0 ? webToolsDraft.braveApiKey.trim() : undefined,
        dashscope_api_key: webToolsDraft.dashscopeApiKey.trim().length > 0 ? webToolsDraft.dashscopeApiKey.trim() : undefined
      });
      setWebToolsSettings(next);
      setWebToolsDraft(toWebToolsDraft(next));
      setWebToolsTestResult("");
      setStatus(t("webToolsSaved"));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t("webToolsSaveFailed"));
    }
  }

  async function handleTestWebTools() {
    try {
      const result = await testWebToolsSettings("sedna personal assistant");
      setWebToolsTestResult(`${result.ok ? t("connectionPassed") : t("connectionFailed")}: ${result.message}`);
    } catch (error) {
      setWebToolsTestResult(error instanceof Error ? error.message : t("connectionFailed"));
    }
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

  async function handleUploadSkills(file: File) {
    const name = file.name.toLowerCase();
    if (!name.endsWith(".zip") && file.type !== "application/zip" && file.type !== "application/x-zip-compressed") {
      setStatus(t("skillUploadInvalidFile"));
      return;
    }
    try {
      const result = await uploadSkillsZip(file);
      setTestResult(`${t("skillUploadSuccess")}: ${result.imported.map((skill) => skill.name).join(", ")}`);
      await refreshRuntimeConfig();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t("skillUploadFailed"));
    }
  }

  async function handleToggleSkill(skill: SkillResponse) {
    await patchSkill(skill.id, { enabled: !skill.enabled });
    await refreshRuntimeConfig();
  }

  async function handleDeleteSkill(skill: SkillResponse) {
    await deleteSkill(skill.id);
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
          <NavItem icon={<MessageSquare size={17} />} label={t("navChat")} active={activeTab === "chat"} onClick={() => navigateToTab("chat")} />
          <NavItem icon={<Inbox size={17} />} label={t("navMemory")} active={activeTab === "memory"} onClick={() => navigateToTab("memory")} />
          <NavItem icon={<ClipboardList size={17} />} label={t("navTasks")} active={activeTab === "tasks"} onClick={() => navigateToTab("tasks")} />
          <NavItem icon={<GitBranch size={17} />} label={t("navGraph")} active={activeTab === "graph"} onClick={() => navigateToTab("graph")} />
          <NavItem icon={<Database size={17} />} label={t("navWorkers")} active={activeTab === "workers"} onClick={() => navigateToTab("workers")} />
          <NavItem icon={<Activity size={17} />} label={t("navAgents")} active={activeTab === "activity"} onClick={() => navigateToTab("activity")} />
          <NavItem icon={<Database size={17} />} label={t("navAudit")} active={activeTab === "audit"} onClick={() => navigateToTab("audit")} />
          <NavItem icon={<SettingsIcon size={17} />} label={t("navSettings")} active={activeTab === "settings"} onClick={() => navigateToTab("settings")} />
        </nav>
        <div className="system-list">
          <span className="section-label">{t("system")}</span>
          <SystemRow label={t("graphDb")} />
          <SystemRow label={t("memoryInbox")} />
          <SystemRow label={t("workers")} count={onlineWorkerCount} />
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
          <div className="owner-chip"><UserRound size={16} /> {t("owner")}</div>
        </header>

        <section className="content-surface">
          {activeTab === "chat" && (
            <div className="chat-workspace">
              <ConversationList
                conversations={conversations}
                activeConversationId={conversationId}
                onNew={handleNewConversation}
                onOpen={(id) => void openConversation(id)}
                onRename={(conversation) => void handleRenameConversation(conversation)}
                onDelete={(conversation) => void handleDeleteConversation(conversation)}
                t={t}
              />
              <ChatTimeline
                messages={messages}
                draft={draft}
                setDraft={setDraft}
                submitMessage={submitMessage}
                tools={tools}
                skills={skills}
                t={t}
                locale={settings.uiLocale}
                activities={chatActivities}
                chatRunInProgress={chatRunInProgress}
                confirmations={confirmations}
                tasks={tasks}
                onApproveConfirmation={handleApproveConfirmation}
                onRejectConfirmation={handleRejectConfirmation}
                onTaskStatus={handleTaskStatus}
              />
            </div>
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
          {activeTab === "workers" && (
            <WorkerPanel
              details={workerDetails}
              pairCode={workerPairCode}
              onCreatePairCode={() => void handleCreateWorkerPairCode()}
              onRevokeWorker={(worker) => void handleRevokeWorker(worker)}
              onPatchCapability={(workerId, capability, patch) => void handlePatchWorkerCapability(workerId, capability, patch)}
              onCreatePathScope={(workerId, input) => void handleCreateWorkerPathScope(workerId, input)}
              onPatchPathScope={(workerId, scope, patch) => void handlePatchWorkerPathScope(workerId, scope, patch)}
              onDeletePathScope={(workerId, scope) => void handleDeleteWorkerPathScope(workerId, scope)}
              t={t}
              locale={settings.uiLocale}
            />
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
                onMcpDraftChange={setMcpDraft}
                onSaveMcpServer={handleSaveMcpServer}
                onEditMcpServer={handleEditMcpServer}
                onDisableMcpServer={handleDisableMcpServer}
                onTestMcpServer={handleTestMcpServer}
                onRefreshMcpServer={handleRefreshMcpServer}
                onPatchTool={handlePatchTool}
                onTestTool={handleTestTool}
                onUploadSkills={handleUploadSkills}
                onToggleSkill={handleToggleSkill}
                onDeleteSkill={handleDeleteSkill}
                webToolsDraft={webToolsDraft}
                webToolsSettings={webToolsSettings}
                onWebToolsDraftChange={setWebToolsDraft}
                onSaveWebTools={handleSaveWebTools}
                onTestWebTools={handleTestWebTools}
                webToolsTestResult={webToolsTestResult}
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

function ConversationList({
  conversations,
  activeConversationId,
  onNew,
  onOpen,
  onRename,
  onDelete,
  t
}: {
  conversations: Conversation[];
  activeConversationId?: string;
  onNew: () => void;
  onOpen: (id: string) => void;
  onRename: (conversation: Conversation) => void;
  onDelete: (conversation: Conversation) => void;
  t: (key: TranslationKey) => string;
}) {
  return (
    <aside className="conversation-section chat-conversations-panel">
      <div className="section-heading">
        <span className="section-label">{t("conversations")}</span>
        <button className="icon-button" onClick={onNew} title={t("newConversation")} aria-label={t("newConversation")}>
          <Plus size={14} />
        </button>
      </div>
      <div className="conversation-list">
        {conversations.length === 0 && <div className="empty-sidebar-state">{t("noConversations")}</div>}
        {conversations.map((conversation) => (
          <div className={`conversation-row ${conversation.id === activeConversationId ? "active" : ""}`} key={conversation.id}>
            <button className="conversation-open" onClick={() => onOpen(conversation.id)} title={conversation.title}>
              <MessageSquare size={14} />
              <span>{conversation.title}</span>
            </button>
            <div className="conversation-actions">
              <button onClick={() => onRename(conversation)} title={t("renameConversation")} aria-label={t("renameConversation")}>
                <Pencil size={13} />
              </button>
              <button onClick={() => onDelete(conversation)} title={t("deleteConversation")} aria-label={t("deleteConversation")}>
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

function SystemRow({ label, count }: { label: string; count?: number }) {
  return <div className="system-row"><span>{label}</span>{count !== undefined ? <strong>{count}</strong> : <Circle size={8} fill="currentColor" />}</div>;
}

function ChatTimeline({
  messages,
  draft,
  setDraft,
  submitMessage,
  tools,
  skills,
  t,
  locale,
  activities,
  chatRunInProgress,
  confirmations,
  tasks,
  onApproveConfirmation,
  onRejectConfirmation,
  onTaskStatus
}: {
  messages: Message[];
  draft: string;
  setDraft: (value: string) => void;
  submitMessage: () => void;
  tools: ToolRegistryResponse[];
  skills: SkillResponse[];
  t: (key: TranslationKey) => string;
  locale: UiLocale;
  activities: ChatActivity[];
  chatRunInProgress: boolean;
  confirmations: ConfirmationItem[];
  tasks: TaskItem[];
  onApproveConfirmation: (confirmation: ConfirmationItem) => void;
  onRejectConfirmation: (confirmation: ConfirmationItem) => void;
  onTaskStatus: (task: TaskItem, status: TaskStatus) => void;
}) {
  const isComposingRef = useRef(false);
  const messageListRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionStart, setMentionStart] = useState(0);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const visibleActivities = selectVisibleChatActivities(activities);
  const openConfirmations = confirmations.filter((item) => item.status === "pending").slice(0, 2);
  const suggestedTasks = chatRunInProgress
    ? tasks.filter((task) => task.status === "suggested").slice(0, 1)
    : [];
  const showTimelineStack = openConfirmations.length > 0 || suggestedTasks.length > 0;
  const mentionOptions = useMemo(
    () => buildMentionOptions(mentionQuery, skills, tools),
    [mentionQuery, skills, tools]
  );

  useEffect(() => {
    const list = messageListRef.current;
    if (list) {
      list.scrollTop = list.scrollHeight;
    }
  }, [messages.length, visibleActivities.length]);

  useEffect(() => {
    setMentionIndex(0);
  }, [mentionQuery, mentionOpen]);

  function syncMentionState(value: string, cursor: number) {
    const active = getActiveMention(value, cursor);
    if (!active) {
      setMentionOpen(false);
      setMentionQuery("");
      return;
    }
    setMentionOpen(true);
    setMentionStart(active.start);
    setMentionQuery(active.query);
  }

  function applyMention(option: MentionOption) {
    const textarea = textareaRef.current;
    const cursor = textarea?.selectionStart ?? draft.length;
    const token = option.kind === "skill" ? `@skill:${option.name}` : `@tool:${option.name}`;
    const nextDraft = `${draft.slice(0, mentionStart)}${token} ${draft.slice(cursor)}`;
    const nextCursor = mentionStart + token.length + 1;
    setDraft(nextDraft);
    setMentionOpen(false);
    setMentionQuery("");
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(nextCursor, nextCursor);
    });
  }

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
              <div className="message-body">
                {message.role === "assistant"
                  ? (
                      <>
                        <MessageMarkdown content={message.content} />
                        {message.metadata.pending === true ? <span className="stream-caret" /> : null}
                      </>
                    )
                  : <p>{message.content}</p>}
              </div>
              {message.role === "assistant" && message.metadata.pending === true && visibleActivities.length > 0 && (
                <div className="agent-steps" aria-live="polite">
                  {visibleActivities.map((activity, index) => (
                    <span
                      key={activity.id}
                      className={index === visibleActivities.length - 1 ? "active" : undefined}
                    >
                      {activity.title}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </article>
        ))}
        {showTimelineStack && (
          <div className="timeline-card-stack" aria-label={t("agentTimelineUpdates")}>
            {openConfirmations.map((confirmation) => (
              <ConfirmationCard
                confirmation={confirmation}
                key={confirmation.id}
                onApprove={onApproveConfirmation}
                onReject={onRejectConfirmation}
                t={t}
              />
            ))}
            {suggestedTasks.map((task) => (
              <TaskCard task={task} key={task.id} onTaskStatus={onTaskStatus} t={t} locale={locale} compact />
            ))}
          </div>
        )}
      </div>
      <div className="composer">
        <div className="composer-input">
          {mentionOpen && mentionOptions.length > 0 && (
            <div className="mention-picker" role="listbox">
              {mentionOptions.map((option, index) => (
                <button
                  type="button"
                  key={`${option.kind}:${option.name}`}
                  className={`mention-option${index === mentionIndex ? " active" : ""}`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    applyMention(option);
                  }}
                >
                  <strong>{option.kind === "skill" ? t("mentionSkills") : t("mentionTools")} · {option.label}</strong>
                  <span>{option.description || option.name}</span>
                </button>
              ))}
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              syncMentionState(event.target.value, event.target.selectionStart ?? event.target.value.length);
            }}
            onClick={(event) => {
              syncMentionState(event.currentTarget.value, event.currentTarget.selectionStart ?? event.currentTarget.value.length);
            }}
            onKeyUp={(event) => {
              syncMentionState(event.currentTarget.value, event.currentTarget.selectionStart ?? event.currentTarget.value.length);
            }}
            onCompositionStart={() => {
              isComposingRef.current = true;
            }}
            onCompositionEnd={() => {
              isComposingRef.current = false;
            }}
            onKeyDown={(event) => {
              if (mentionOpen && mentionOptions.length > 0) {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setMentionIndex((current) => (current + 1) % mentionOptions.length);
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setMentionIndex((current) => (current - 1 + mentionOptions.length) % mentionOptions.length);
                  return;
                }
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  applyMention(mentionOptions[mentionIndex]);
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setMentionOpen(false);
                  return;
                }
              }
              if (event.key !== "Enter" || event.shiftKey) {
                return;
              }
              if (event.nativeEvent.isComposing || isComposingRef.current || event.keyCode === 229) {
                return;
              }
              event.preventDefault();
              void submitMessage();
            }}
            placeholder={t("messagePlaceholderWithMention")}
          />
        </div>
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
              <small>{memoryKindLabel(candidate.kind, t)} · {t("source")}: {sourceLabel(candidate)}</small>
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
  const evidenceById = useMemo(() => new Map(graph.evidence.map((item) => [item.id, item])), [graph.evidence]);
  const detailNodes = useMemo(() => {
    const profileAttributes = graph.nodes.filter((node) => node.type === "profile_attribute");
    if (profileAttributes.length > 0) {
      return profileAttributes;
    }
    return graph.nodes.filter((node) => node.type !== "owner" && node.type !== "owner_profile").slice(0, 6);
  }, [graph.nodes]);
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
        {detailNodes.map((node) => {
          const latestEvidenceId = typeof node.payload.latestEvidenceId === "string" ? node.payload.latestEvidenceId : undefined;
          const evidenceQuote = latestEvidenceId ? evidenceById.get(latestEvidenceId)?.quote : undefined;
          return (
            <div className="graph-detail-row" key={node.id}>
              <strong>{node.label}</strong>
              <span>{node.type} · {t("confidence")}: {node.confidence.toFixed(2)}</span>
              {evidenceQuote && <blockquote>{evidenceQuote}</blockquote>}
            </div>
          );
        })}
      </div>
      <footer className="panel-footer">{t("nodes")}: {graph.nodes.length} · {t("edges")}: {graph.edges.length} · {t("evidence")}: {graph.evidence.length}</footer>
    </section>
  );
}

function WorkerPanel({
  details,
  pairCode,
  onCreatePairCode,
  onRevokeWorker,
  onPatchCapability,
  onCreatePathScope,
  onPatchPathScope,
  onDeletePathScope,
  t,
  locale
}: {
  details: WorkerDetailResponse[];
  pairCode: string;
  onCreatePairCode: () => void;
  onRevokeWorker: (worker: Worker) => void;
  onPatchCapability: (
    workerId: string,
    capability: Capability,
    patch: Partial<{ enabled: boolean; risk: RiskLevel; requires_confirmation: boolean }>
  ) => void;
  onCreatePathScope: (workerId: string, input: { label: string; path: string }) => void;
  onPatchPathScope: (workerId: string, scope: WorkerPathScope, patch: Partial<{ label: string; path: string; enabled: boolean }>) => void;
  onDeletePathScope: (workerId: string, scope: WorkerPathScope) => void;
  t: (key: TranslationKey) => string;
  locale: UiLocale;
}) {
  const activeDetails = details.filter((detail) => detail.worker.status !== "revoked");
  return (
    <section className="panel feature-panel worker-panel">
      <div className="panel-header">
        <h1>{t("workers")}</h1>
        <button className="ghost-button" onClick={onCreatePairCode}><Plus size={15} /> {t("createPairCode")}</button>
      </div>
      <div className="worker-panel-intro">{t("workerPolicyHint")}</div>
      {pairCode && (
        <div className="pair-code-box">
          <span>{t("pairCode")}</span>
          <strong>{pairCode}</strong>
        </div>
      )}
      <div className="worker-grid">
        {activeDetails.length === 0 && <div className="empty-state">{t("noWorkers")}</div>}
        {activeDetails.map((detail) => (
          <WorkerCard
            detail={detail}
            key={detail.worker.id}
            onRevokeWorker={onRevokeWorker}
            onPatchCapability={onPatchCapability}
            onCreatePathScope={onCreatePathScope}
            onPatchPathScope={onPatchPathScope}
            onDeletePathScope={onDeletePathScope}
            t={t}
            locale={locale}
          />
        ))}
      </div>
    </section>
  );
}

function WorkerCard({
  detail,
  onRevokeWorker,
  onPatchCapability,
  onCreatePathScope,
  onPatchPathScope,
  onDeletePathScope,
  t,
  locale
}: {
  detail: WorkerDetailResponse;
  onRevokeWorker: (worker: Worker) => void;
  onPatchCapability: (
    workerId: string,
    capability: Capability,
    patch: Partial<{ enabled: boolean; risk: RiskLevel; requires_confirmation: boolean }>
  ) => void;
  onCreatePathScope: (workerId: string, input: { label: string; path: string }) => void;
  onPatchPathScope: (workerId: string, scope: WorkerPathScope, patch: Partial<{ label: string; path: string; enabled: boolean }>) => void;
  onDeletePathScope: (workerId: string, scope: WorkerPathScope) => void;
  t: (key: TranslationKey) => string;
  locale: UiLocale;
}) {
  const { worker } = detail;
  const [pathDraft, setPathDraft] = useState({ label: "", path: "" });
  return (
    <article className={`worker-card ${worker.status}`}>
      <div className="worker-card-header">
        <div>
          <strong>{worker.displayName}</strong>
          <span>{worker.environment}{worker.hostName ? ` · ${worker.hostName}` : ""}</span>
        </div>
        <div className="worker-actions">
          <span className={`status-badge ${worker.status}`}>{worker.status}</span>
          {worker.status !== "revoked" && (
            <button className="icon-button danger" onClick={() => onRevokeWorker(worker)} title={t("revokeWorker")} aria-label={t("revokeWorker")}>
              <X size={14} />
            </button>
          )}
        </div>
      </div>
      <div className="worker-meta">
        <span>{t("lastHeartbeat")}: {worker.lastSeenAt ? new Date(worker.lastSeenAt).toLocaleString(locale) : t("unknown")}</span>
        {worker.os && <span>{t("os")}: {worker.os}</span>}
      </div>
      <WorkerSection title={t("capabilities")} stack>
        {detail.capabilities.length === 0 && <span className="muted-text">{t("none")}</span>}
        {detail.capabilities.map((capability) => (
          <WorkerCapabilityRow
            capability={capability}
            key={capability.id}
            onPatch={(patch) => onPatchCapability(worker.id, capability, patch)}
            t={t}
          />
        ))}
      </WorkerSection>
      <WorkerSection title={t("allowedPaths")} stack>
        {detail.pathScopes.length === 0 && <span className="muted-text">{t("noAllowedPaths")}</span>}
        {detail.pathScopes.map((scope) => (
          <WorkerPathScopeRow
            key={scope.id}
            onDelete={() => onDeletePathScope(worker.id, scope)}
            onPatch={(patch) => onPatchPathScope(worker.id, scope, patch)}
            scope={scope}
            t={t}
          />
        ))}
        <form
          className="worker-path-form"
          onSubmit={(event) => {
            event.preventDefault();
            const label = pathDraft.label.trim();
            const pathValue = pathDraft.path.trim();
            if (!label || !pathValue) {
              return;
            }
            onCreatePathScope(worker.id, { label, path: pathValue });
            setPathDraft({ label: "", path: "" });
          }}
        >
          <input
            placeholder={t("pathScopeLabel")}
            value={pathDraft.label}
            onChange={(event) => setPathDraft((current) => ({ ...current, label: event.target.value }))}
          />
          <input
            placeholder={t("pathScopePath")}
            value={pathDraft.path}
            onChange={(event) => setPathDraft((current) => ({ ...current, path: event.target.value }))}
          />
          <button className="ghost-button" type="submit"><Plus size={14} /> {t("addPathScope")}</button>
        </form>
      </WorkerSection>
      <WorkerSection title={t("recentJobs")} stack>
        {detail.recentJobs.length === 0 && <span className="muted-text">{t("noWorkerJobs")}</span>}
        {detail.recentJobs.slice(0, 6).map((job) => <WorkerJobRow job={job} key={job.id} t={t} locale={locale} />)}
      </WorkerSection>
    </article>
  );
}

function WorkerCapabilityRow({
  capability,
  onPatch,
  t
}: {
  capability: Capability;
  onPatch: (patch: Partial<{ enabled: boolean; risk: RiskLevel; requires_confirmation: boolean }>) => void;
  t: (key: TranslationKey) => string;
}) {
  return (
    <div className="worker-capability-row">
      <div>
        <strong>{capability.name}</strong>
        <span>{capability.readOnly ? t("readOnly") : t("readWrite")}</span>
      </div>
      <select
        value={capability.risk}
        onChange={(event) => onPatch({ risk: event.target.value as RiskLevel })}
      >
        <option value="low">{t("low")}</option>
        <option value="medium">{t("medium")}</option>
        <option value="high">{t("high")}</option>
      </select>
      <label className="route-enabled">
        <input
          checked={capability.requiresConfirmation}
          onChange={(event) => onPatch({ requires_confirmation: event.target.checked })}
          type="checkbox"
        />
        {t("requiresConfirmation")}
      </label>
      <label className="route-enabled">
        <input
          checked={capability.enabled}
          onChange={(event) => onPatch({ enabled: event.target.checked })}
          type="checkbox"
        />
        {t("enabled")}
      </label>
    </div>
  );
}

function WorkerPathScopeRow({
  scope,
  onPatch,
  onDelete,
  t
}: {
  scope: WorkerPathScope;
  onPatch: (patch: Partial<{ label: string; path: string; enabled: boolean }>) => void;
  onDelete: () => void;
  t: (key: TranslationKey) => string;
}) {
  const [label, setLabel] = useState(scope.label);
  const [pathValue, setPathValue] = useState(scope.path);

  useEffect(() => {
    setLabel(scope.label);
    setPathValue(scope.path);
  }, [scope.label, scope.path]);

  return (
    <div className="worker-path-scope-row">
      <input
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        onBlur={() => {
          const next = label.trim();
          if (next && next !== scope.label) {
            onPatch({ label: next });
          }
        }}
      />
      <input
        value={pathValue}
        onChange={(event) => setPathValue(event.target.value)}
        onBlur={() => {
          const next = pathValue.trim();
          if (next && next !== scope.path) {
            onPatch({ path: next });
          }
        }}
      />
      <label className="route-enabled">
        <input
          checked={scope.enabled}
          onChange={(event) => onPatch({ enabled: event.target.checked })}
          type="checkbox"
        />
        {t("enabled")}
      </label>
      <button className="icon-button danger" onClick={onDelete} title={t("deletePathScope")} aria-label={t("deletePathScope")} type="button">
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function WorkerSection({ title, children, stack = false }: { title: string; children: React.ReactNode; stack?: boolean }) {
  return (
    <div className="worker-section">
      <span className="section-label">{title}</span>
      <div className={stack ? "worker-config-list" : undefined}>{children}</div>
    </div>
  );
}

function WorkerJobRow({ job, t, locale }: { job: WorkerJob; t: (key: TranslationKey) => string; locale: UiLocale }) {
  return (
    <details className={`worker-job-row ${job.status}`}>
      <summary>
        <span>{job.capability}</span>
        <span className={`status-badge ${job.status}`}>{job.status}</span>
      </summary>
      <div className="worker-job-detail">
        <small>{t("createdAt")}: {new Date(job.createdAt).toLocaleString(locale)}</small>
        {job.error && <p className="error-text">{job.error}</p>}
        {job.result && <pre>{JSON.stringify(job.result, null, 2)}</pre>}
      </div>
    </details>
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

function SettingsSectionHeader({
  title,
  actionLabel,
  onAction
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="settings-section-header">
      <h2>{title}</h2>
      {actionLabel && onAction && (
        <button type="button" className="primary-button settings-add-button" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}

function SettingsModal({
  open,
  title,
  onClose,
  children,
  footer
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  if (!open) {
    return null;
  }
  return (
    <div className="settings-modal-overlay" onClick={onClose}>
      <div
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="settings-modal-header">
          <h3>{title}</h3>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="settings-modal-body">{children}</div>
        {footer && <div className="settings-modal-footer settings-actions">{footer}</div>}
      </div>
    </div>
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
  onMcpDraftChange,
  onSaveMcpServer,
  onEditMcpServer,
  onDisableMcpServer,
  onTestMcpServer,
  onRefreshMcpServer,
  onPatchTool,
  onTestTool,
  onUploadSkills,
  onToggleSkill,
  onDeleteSkill,
  webToolsDraft,
  webToolsSettings,
  onWebToolsDraftChange,
  onSaveWebTools,
  onTestWebTools,
  webToolsTestResult,
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
  onMcpDraftChange: (draft: McpServerDraft) => void;
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
  onUploadSkills: (file: File) => void;
  onToggleSkill: (skill: SkillResponse) => void;
  onDeleteSkill: (skill: SkillResponse) => void;
  webToolsDraft: WebToolsDraft;
  webToolsSettings: WebToolsSettingsResponse | null;
  onWebToolsDraftChange: (draft: WebToolsDraft) => void;
  onSaveWebTools: () => void;
  onTestWebTools: () => void;
  webToolsTestResult: string;
  t: (key: TranslationKey) => string;
}) {
  const [providerModalOpen, setProviderModalOpen] = useState(false);
  const [webToolsModalOpen, setWebToolsModalOpen] = useState(false);

  function openAddProvider() {
    onProviderDraftChange(emptyProviderDraft());
    setProviderModalOpen(true);
  }

  function openEditProvider(provider: LlmProviderResponse) {
    void onEditProvider(provider);
    setProviderModalOpen(true);
  }

  function closeProviderModal() {
    setProviderModalOpen(false);
    onProviderDraftChange(emptyProviderDraft());
  }

  async function saveProviderFromModal() {
    await onSaveProvider();
    setProviderModalOpen(false);
  }

  function openWebToolsModal() {
    if (webToolsSettings) {
      onWebToolsDraftChange(toWebToolsDraft(webToolsSettings));
    }
    setWebToolsModalOpen(true);
  }

  function closeWebToolsModal() {
    if (webToolsSettings) {
      onWebToolsDraftChange(toWebToolsDraft(webToolsSettings));
    }
    setWebToolsModalOpen(false);
  }

  async function saveWebToolsFromModal() {
    await onSaveWebTools();
    setWebToolsModalOpen(false);
  }

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
        <SettingsSectionHeader title={t("llmConfiguration")} actionLabel={t("addProvider")} onAction={openAddProvider} />
        <div className="settings-copy">{t("llmPrivacyNote")}</div>

        <SettingsModal
          open={providerModalOpen}
          title={providerDraft.id ? t("editProvider") : t("addProvider")}
          onClose={closeProviderModal}
          footer={(
            <>
              <button type="button" className="ghost-button" onClick={closeProviderModal}>{t("cancel")}</button>
              <button type="button" className="primary-button" onClick={() => void saveProviderFromModal()}>
                {providerDraft.id ? t("save") : t("addProvider")}
              </button>
            </>
          )}
        >
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
          </div>
        </SettingsModal>

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
                <button type="button" onClick={() => openEditProvider(provider)} title={t("edit")}><Pencil size={15} /></button>
                <button type="button" onClick={() => void onTestProvider(provider)} title={t("testConnection")}><Check size={15} /></button>
                <button type="button" onClick={() => void onDisableProvider(provider)} title={t("disable")}><X size={15} /></button>
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

      <div className="settings-section llm-settings">
        <SettingsSectionHeader title={t("webToolsConfiguration")} actionLabel={t("configure")} onAction={openWebToolsModal} />
        <div className="settings-copy">{t("webToolsDescription")}</div>
        <div className="settings-summary-row">
          <span>
            {webToolsSettings?.enabled ? t("enabled") : t("disabled")}
            {" · "}
            {webToolsSettings?.configured ? t("webToolsConfigured") : t("webToolsNotConfigured")}
          </span>
        </div>
        {webToolsTestResult && <div className="settings-copy">{webToolsTestResult}</div>}

        <SettingsModal
          open={webToolsModalOpen}
          title={t("webToolsConfiguration")}
          onClose={closeWebToolsModal}
          footer={(
            <>
              <button type="button" className="ghost-button" onClick={closeWebToolsModal}>{t("cancel")}</button>
              <button type="button" className="ghost-button" onClick={() => void onTestWebTools()}>{t("testWebSearch")}</button>
              <button type="button" className="primary-button" onClick={() => void saveWebToolsFromModal()}>{t("save")}</button>
            </>
          )}
        >
          <div className="provider-editor">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={webToolsDraft.enabled}
                onChange={(event) => onWebToolsDraftChange({ ...webToolsDraft, enabled: event.target.checked })}
              />
              <span>{t("webToolsEnabled")}</span>
            </label>
            <label>
              <span>{t("webSearchProvider")}</span>
              <select
                value={webToolsDraft.searchProvider}
                onChange={(event) => onWebToolsDraftChange({
                  ...webToolsDraft,
                  searchProvider: event.target.value as WebToolsDraft["searchProvider"]
                })}
              >
                <option value="duckduckgo">{t("webSearchProviderDuckduckgo")}</option>
                <option value="brave">{t("webSearchProviderBrave")}</option>
                <option value="bailian">{t("webSearchProviderBailian")}</option>
                <option value="searxng">{t("webSearchProviderSearxng")}</option>
              </select>
            </label>
            {webToolsDraft.searchProvider === "brave" && (
              <label>
                <span>{t("braveSearchApiKey")}</span>
                <input
                  type="password"
                  placeholder={webToolsSettings?.has_brave_api_key ? t("hasApiKey") : t("apiKey")}
                  value={webToolsDraft.braveApiKey}
                  onChange={(event) => onWebToolsDraftChange({ ...webToolsDraft, braveApiKey: event.target.value })}
                />
              </label>
            )}
            {webToolsDraft.searchProvider === "bailian" && (
              <label>
                <span>{t("dashscopeApiKey")}</span>
                <input
                  type="password"
                  placeholder={webToolsSettings?.has_dashscope_api_key ? t("hasApiKey") : t("dashscopeApiKeyPlaceholder")}
                  value={webToolsDraft.dashscopeApiKey}
                  onChange={(event) => onWebToolsDraftChange({ ...webToolsDraft, dashscopeApiKey: event.target.value })}
                />
              </label>
            )}
            {webToolsDraft.searchProvider === "searxng" && (
              <label>
                <span>{t("searxngBaseUrl")}</span>
                <input
                  value={webToolsDraft.searxngUrl}
                  placeholder="http://localhost:8888"
                  onChange={(event) => onWebToolsDraftChange({ ...webToolsDraft, searxngUrl: event.target.value })}
                />
              </label>
            )}
            <label>
              <span>{t("searchMaxResults")}</span>
              <input
                type="number"
                min="1"
                max="10"
                value={webToolsDraft.searchMaxResults}
                onChange={(event) => onWebToolsDraftChange({ ...webToolsDraft, searchMaxResults: Number(event.target.value) })}
              />
            </label>
            <label>
              <span>{t("fetchMaxChars")}</span>
              <input
                type="number"
                min="1000"
                max="50000"
                value={webToolsDraft.fetchMaxChars}
                onChange={(event) => onWebToolsDraftChange({ ...webToolsDraft, fetchMaxChars: Number(event.target.value) })}
              />
            </label>
            <label>
              <span>{t("fetchTimeoutMs")}</span>
              <input
                type="number"
                min="1000"
                max="60000"
                value={webToolsDraft.fetchTimeoutMs}
                onChange={(event) => onWebToolsDraftChange({ ...webToolsDraft, fetchTimeoutMs: Number(event.target.value) })}
              />
            </label>
            <div className="settings-copy">
              {webToolsSettings?.configured ? t("webToolsConfigured") : t("webToolsNotConfigured")}
            </div>
          </div>
        </SettingsModal>
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
        onUpload={onUploadSkills}
        onToggle={onToggleSkill}
        onDelete={onDeleteSkill}
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
  const [modalOpen, setModalOpen] = useState(false);

  function openAddModal() {
    onDraftChange(emptyMcpDraft());
    setModalOpen(true);
  }

  function openEditModal(server: McpServerResponse) {
    onEdit(server);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    onDraftChange(emptyMcpDraft());
  }

  async function saveFromModal() {
    await onSave();
    setModalOpen(false);
  }

  return (
    <div className="settings-section llm-settings">
      <SettingsSectionHeader title={t("mcpServers")} actionLabel={t("addMcpServer")} onAction={openAddModal} />
      <div className="settings-copy">{t("mcpSafetyNote")}</div>

      <SettingsModal
        open={modalOpen}
        title={draft.id ? t("editMcpServer") : t("addMcpServer")}
        onClose={closeModal}
        footer={(
          <>
            <button type="button" className="ghost-button" onClick={closeModal}>{t("cancel")}</button>
            <button type="button" className="primary-button" onClick={() => void saveFromModal()}>
              {draft.id ? t("save") : t("addMcpServer")}
            </button>
          </>
        )}
      >
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
        </div>
      </SettingsModal>

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
              <button type="button" onClick={() => openEditModal(server)} title={t("edit")}><Pencil size={15} /></button>
              <button type="button" onClick={() => void onTest(server)} title={t("testConnection")}><Check size={15} /></button>
              <button type="button" onClick={() => void onRefresh(server)} title={t("refreshTools")}><Activity size={15} /></button>
              <button type="button" onClick={() => void onDisable(server)} title={t("disable")}><X size={15} /></button>
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

function SkillsSection({ skills, onUpload, onToggle, onDelete, t }: {
  skills: SkillResponse[];
  onUpload: (file: File) => void;
  onToggle: (skill: SkillResponse) => void;
  onDelete: (skill: SkillResponse) => void;
  t: (key: TranslationKey) => string;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  function handleFile(file: File | undefined) {
    if (file) {
      onUpload(file);
      setModalOpen(false);
    }
  }

  return (
    <div className="settings-section">
      <SettingsSectionHeader title={t("skills")} actionLabel={t("uploadSkillsZip")} onAction={() => setModalOpen(true)} />

      <SettingsModal
        open={modalOpen}
        title={t("uploadSkillsZip")}
        onClose={() => setModalOpen(false)}
      >
        <p className="settings-copy">{t("uploadSkillsHint")}</p>
        <label
          className={`skill-upload-dropzone${dragOver ? " drag-over" : ""}`}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            if (event.relatedTarget instanceof globalThis.Node && event.currentTarget.contains(event.relatedTarget)) {
              return;
            }
            setDragOver(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            handleFile(event.dataTransfer.files[0]);
          }}
        >
          <span>{t("uploadSkillsZip")}</span>
          <small>{t("uploadSkillsDropHint")}</small>
          <input
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed"
            onChange={(event) => {
              handleFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </label>
      </SettingsModal>

      <div className="skill-list">
        {skills.length === 0 && <div className="empty-sidebar-state">{t("noSkills")}</div>}
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
              <button className="ghost-button" onClick={() => void onDelete(skill)}>{t("deleteSkill")}</button>
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

function readRoute(): AppRoute {
  const segments = window.location.pathname.split("/").filter(Boolean);
  const tab = isMainTab(segments[0]) ? segments[0] : "chat";
  return {
    tab,
    conversationId: tab === "chat" ? segments[1] : undefined
  };
}

function isMainTab(value: string | undefined): value is MainTab {
  return value === "chat" || value === "memory" || value === "tasks" || value === "graph" ||
    value === "workers" || value === "activity" || value === "audit" || value === "settings";
}

function pathForRoute(route: AppRoute): string {
  if (route.tab === "chat") {
    return route.conversationId ? `/chat/${route.conversationId}` : "/chat";
  }
  return `/${route.tab}`;
}

function writeRoute(route: AppRoute, mode: "push" | "replace" = "push"): void {
  const path = pathForRoute(route);
  if (window.location.pathname === path) {
    return;
  }
  if (mode === "replace") {
    window.history.replaceState(null, "", path);
  } else {
    window.history.pushState(null, "", path);
  }
}

interface MentionOption {
  kind: "skill" | "tool";
  name: string;
  label: string;
  description: string;
}

function getActiveMention(value: string, cursor: number): { start: number; query: string } | null {
  const before = value.slice(0, cursor);
  const match = before.match(/(?:^|\s)@([a-zA-Z0-9._:-]*)$/);
  if (!match) {
    return null;
  }
  const query = match[1];
  return { start: before.length - query.length - 1, query };
}

function buildMentionOptions(
  query: string,
  skills: SkillResponse[],
  tools: ToolRegistryResponse[]
): MentionOption[] {
  const normalized = query.toLowerCase();
  const showSkills = !normalized.startsWith("tool:");
  const showTools = !normalized.startsWith("skill:");
  const skillQuery = normalized.startsWith("skill:") ? normalized.slice("skill:".length) : normalized;
  const toolQuery = normalized.startsWith("tool:") ? normalized.slice("tool:".length) : normalized;
  const options: MentionOption[] = [];

  if (showSkills) {
    for (const skill of skills) {
      if (!skill.enabled) {
        continue;
      }
      const token = `skill:${skill.name}`.toLowerCase();
      if (
        normalized
        && !token.includes(normalized)
        && !skill.name.toLowerCase().includes(skillQuery)
        && !skill.description.toLowerCase().includes(skillQuery)
      ) {
        continue;
      }
      options.push({
        kind: "skill",
        name: skill.name,
        label: skill.name,
        description: skill.description
      });
    }
  }

  if (showTools) {
    for (const tool of tools) {
      if (!tool.enabled) {
        continue;
      }
      const token = `tool:${tool.name}`.toLowerCase();
      if (
        normalized
        && !token.includes(normalized)
        && !tool.name.toLowerCase().includes(toolQuery)
        && !tool.title.toLowerCase().includes(toolQuery)
        && !tool.description.toLowerCase().includes(toolQuery)
      ) {
        continue;
      }
      options.push({
        kind: "tool",
        name: tool.name,
        label: tool.title,
        description: tool.description
      });
    }
  }

  return options.slice(0, 12);
}

function emptyWebToolsDraft(): WebToolsDraft {
  return {
    enabled: true,
    searchProvider: "duckduckgo",
    searchMaxResults: 5,
    fetchMaxChars: 8000,
    fetchTimeoutMs: 15000,
    searxngUrl: "",
    braveApiKey: "",
    dashscopeApiKey: ""
  };
}

function toWebToolsDraft(settings: WebToolsSettingsResponse): WebToolsDraft {
  return {
    enabled: settings.enabled,
    searchProvider: settings.search_provider,
    searchMaxResults: settings.search_max_results,
    fetchMaxChars: settings.fetch_max_chars,
    fetchTimeoutMs: settings.fetch_timeout_ms,
    searxngUrl: settings.searxng_url ?? "",
    braveApiKey: "",
    dashscopeApiKey: ""
  };
}

function emptyProviderDraft(): ProviderDraft {
  return {
    displayName: "OpenAI",
    adapterType: "openai-native",
    baseUrl: "",
    apiKey: "",
    defaultModel: "gpt-4.1-mini",
    enabled: true
  };
}

function emptyMcpDraft(): McpServerDraft {
  return {
    name: "",
    transport: "streamable_http",
    command: "",
    args: "",
    url: "",
    headers: "",
    enabled: true,
    trustLevel: "untrusted"
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

function shouldShowAssistantStatus(phase: string): boolean {
  return phase !== "reply_ready" && phase !== "memory_extraction" && phase !== "done";
}

function buildToolActivityTitle(
  t: (key: TranslationKey) => string,
  tool: string,
  phase: string,
  options: { query?: string; url?: string; fallbackTitle?: string }
): string {
  if (tool === "owner_profile_read") {
    return t("readingOwnerProfile");
  }
  if (tool === "memory_search") {
    return options.query ? `${t("searchingMemories")}: ${options.query}` : t("searchingMemories");
  }
  if (tool.startsWith("file.") || tool === "worker.status") {
    return `${options.fallbackTitle ?? tool}${options.query ? `: ${options.query}` : ""}${options.url ? `: ${options.url}` : ""}`;
  }
  if (phase === "search" || tool === "web_search") {
    return options.query ? `${t("webSearchActivity")}: ${options.query}` : t("webSearchActivity");
  }
  if (phase === "fetch" || tool === "web_fetch") {
    return options.url ? `${t("webFetchActivity")}: ${options.url}` : t("webFetchActivity");
  }
  return options.fallbackTitle ?? tool;
}

function selectVisibleChatActivities(activities: ChatActivity[]): ChatActivity[] {
  const deduped: ChatActivity[] = [];
  for (const activity of activities) {
    const previous = deduped[deduped.length - 1];
    if (previous?.title === activity.title) {
      continue;
    }
    deduped.push(activity);
  }
  return deduped.slice(-3);
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

function memoryKindLabel(kind: string, _t: (key: TranslationKey) => string): string {
  return kind;
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
