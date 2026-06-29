# Sedna

[English](README.md) | [简体中文](README.zh-CN.md)

Sedna 是一个单用户、自托管私人助理 agent 系统。

这个项目正在从一个干净的新方向重新开始。它的目标不是做一个通用聊天机器人、SaaS 助理，或者 Electron 桌面壳。它的目标是构建一个可复用的开源框架，让每个人都可以部署属于自己的私人助理。

## 当前方向

Sedna 的设计围绕以下核心展开：

- **中央大脑**：负责记忆、规划、权限、编排和审计
- **分布式 Worker**：运行在用户控制的设备上，暴露受限的本地能力
- **规范记忆图**：由中央大脑统一拥有和维护
- **agent 原生时间线**：包含事件、通知、确认、产物和任务更新
- **human-on-the-loop 自主性**：agent 主动工作，用户监督高风险决策
- **隐私优先的自托管**：用户私有数据不进入代码仓库

## 产品原则

- **单用户，不是 SaaS**：一个部署实例服务一个人。
- **代码可复用，数据私有**：项目可以被复制和部署，但每个实例都有自己的私有画像、记忆、策略、Worker 和产物。
- **服务端优先**：核心产品是中央大脑服务。Web、CLI、Electron、移动端和消息客户端只是访问入口。
- **一个可见记忆图**：用户应该能看到统一的图，包含全局、设备、项目、资源、任务、技能和 Worker 相关知识。
- **中央图权威**：Worker 和客户端不能直接写规范图数据库。它们只能通过 Brain API 提交事件、观察和候选记忆。
- **安全的分布式执行**：Worker 是受控的手，不是独立的大脑。它们在策略和审计下执行受限任务。
- **先理解，但不只分析**：第一版应该理解用户，同时执行安全、可审计的系统内部动作。

## 设计检查点

当前产品和架构文档在这里：

- [docs/README.md](docs/README.md)
- [docs/personal-agent-design-checkpoint.md](docs/personal-agent-design-checkpoint.md)
- [docs/brain-mvp-design.md](docs/brain-mvp-design.md)
- [docs/llm-integration-mvp.md](docs/llm-integration-mvp.md)
- [docs/dynamic-llm-config-design.md](docs/dynamic-llm-config-design.md)
- [docs/agent-runtime-mvp-design.md](docs/agent-runtime-mvp-design.md)
- [docs/agent-workbench-ui-design.md](docs/agent-workbench-ui-design.md)
- [docs/i18n-mvp-design.md](docs/i18n-mvp-design.md)
- [docs/mcp-and-skills-mvp-design.md](docs/mcp-and-skills-mvp-design.md)

这些文档是当前设计讨论的事实来源。它们是工作检查点，不是最终实现规格。

## 预期架构

```text
Central Brain Server
  Agent core
  Canonical memory graph
  Conversation timeline
  Permission policy
  Worker orchestration
  Audit log
  Web API

Distributed Workers
  Device-local capabilities
  Local cache and sync queue
  Worker-side guardrails
  Outbound connection to Central Brain

Web UI
  Chat-first timeline
  Memory graph visualization
  Worker management
  Policy center
  Notifications and confirmations
```

## 仓库状态

这个仓库现在包含第一版 Sedna Brain MVP 基础实现。旧的 Electron 原型和终端 agent workbench 已经移除，项目将继续围绕新的服务端优先、分布式私人 agent 设计推进。

当前实现切片：

- TypeScript + pnpm workspace monorepo
- `apps/brain` 中的中央大脑 API 服务
- `apps/web` 中的 React + Vite Web UI
- `apps/worker` 中的 mock-only worker 包
- `apps/cli` 中的 CLI 骨架
- `packages/` 下的共享 protocol、memory、policy 和工具包
- 基于 SQLite 的规范记忆图 schema 和 migration
- 会话时间线、候选记忆审核、图查询、mock worker 注册和审计查询 API
- LLM provider 边界，支持 deterministic `mock` 模式和真实 `openai` 模式
- Agent Runtime 和 React Agent Workbench 是当前 MVP 设计目标
- 动态 LLM 配置、MCP 和 Skills 是计划中的 MVP 设置能力

## 开发

安装依赖：

```bash
pnpm install
```

运行测试和构建：

```bash
pnpm test
pnpm build
```

启动 Brain API：

```bash
pnpm dev:brain
```

在另一个终端启动 Web UI：

```bash
pnpm dev:web
```

LLM 配置：

```bash
cp .env.example .env
```

默认 provider 是 `mock`，不需要密钥，适合测试和离线开发。要使用真实 OpenAI 对话能力，设置：

```text
LLM_PROVIDER=openai
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4.1-mini
```

不要提交 `.env` 或 API key。

## 隐私和数据

私有数据绝不能提交到这个仓库。

未来的私有运行时数据应该放在未跟踪的源码文件之外，例如：

```text
data/
.env
server/data/
apps/brain/data/
worker/.local/
apps/worker/.local/
```

仓库只应该包含代码、schema、示例配置、测试和文档。

## 待讨论问题

主要设计问题仍在整理中：

- 权限策略模型
- 产物存储和传输
- 用户认证和恢复
- Worker 注册、撤销和离线行为
- 模型/provider 路由和敏感数据处理
- 备份、恢复和迁移

## 开发说明

修改前请先阅读 [AGENTS.md](AGENTS.md)。
