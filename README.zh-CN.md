# Sedna

[English](README.md) | [简体中文](README.zh-CN.md)

Sedna 是一个单用户、自托管私人助理 agent 系统，核心是私有图记忆和分布式设备 Worker。

很多 agent 产品把长期记忆做成分散的聊天记录、笔记或向量化文本片段，也通常只能围绕一台设备或一个云端工作区运行。Sedna 选择另一条路线：把你的生活、项目、设备、资源、偏好、任务和权限组织成一个由中央大脑拥有的可见记忆图，再让你自己设备上的可信 Worker 提供受限的本地上下文和执行能力。

这个项目正在从一个干净的新方向重新开始。它的目标不是做一个通用聊天机器人、SaaS 助理，或者 Electron 桌面壳。它的目标是构建一个可复用的开源框架，让每个人都可以部署属于自己的私人助理基础设施。

## 为什么是 Sedna

Sedna 最重要的是两个核心点：

- **图记忆，而不是分散文本记忆**：长期记忆应该是可查看、可编辑、有证据、有关联的。偏好、项目、文件、联系人、Worker、权限、任务和产物都可以成为图里的节点和关系，而不是沉进不透明的聊天记录里。
- **分布式 Worker，而不是单设备自动化**：真正有用的私人上下文往往分布在多台机器上。家里的服务器、办公室电脑、NAS、VPS 和本地笔记本都可以向同一个中央大脑暴露受限能力，但它们不会变成多个独立大脑。

这种架构可以支持单设备 agent 很难自然完成的协同流程。比如，用户可以让 Sedna 从设备 A 取一个文件、从设备 B 取另一个文件，把两个文件一起作为同一封邮件的附件准备好；中央大脑检查权限和风险，在发送前请求确认，并审计每一步。中央大脑负责计划、记忆、权限和审计，Worker 只执行受限的本地任务。

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

## 文档

通过[中文文档地图](docs/README.zh-CN.md)查找产品、架构、子系统和运行文档。建议先读：

- [私人 Agent 设计检查点](docs/personal-agent-design-checkpoint.md)：当前产品方向和全局架构边界
- [Brain MVP 设计](docs/brain-mvp-design.md)：第一阶段可实现的中央大脑范围
- [Worker MVP 使用说明](docs/worker-mvp-usage.zh-CN.md)：本地 Worker 配置和安全模型
- [消息渠道 MVP](docs/message-channels-mvp.zh-CN.md)：钉钉及飞书/Lark 配置与渠道边界

这些文档是持续维护的检查点，不是冻结的最终实现规格。文档地图说明了重叠文档之间的关系和维护方式。

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
- `apps/worker` 中受策略约束的 Worker Agent runtime
- `apps/cli` 中的 CLI 骨架
- `packages/` 下的共享 protocol、memory、policy 和工具包
- 基于 SQLite 的规范记忆图 schema 和 migration
- 会话时间线、候选记忆审核、图查询、worker 注册/任务 API 和审计查询 API
- 可配置的钉钉和飞书/Lark 长连接渠道，包含 Owner 配对和消息审计
- LLM provider 边界，面向真实 provider 配置
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

创建一次性 worker pair code：

```bash
curl -s -X POST http://127.0.0.1:8787/api/workers/pair-codes \
  -H 'Content-Type: application/json' \
  -d '{"ttl_ms":600000}'
```

再另开一个终端配对本地 Worker：

```bash
SEDNA_BRAIN_URL=http://127.0.0.1:8787 \
SEDNA_WORKER_NAME="Local Worker" \
SEDNA_WORKER_ALLOWED_PATHS="$HOME/Documents:$HOME/Projects" \
pnpm dev:worker pair --code <PAIR-CODE>
```

然后启动已配对 worker：

```bash
pnpm dev:worker
```

然后打开 Workers 页面：

```text
http://127.0.0.1:5173/workers
```

Worker MVP 的详细启动方式、支持能力、API 示例和安全规则见 [docs/worker-mvp-usage.zh-CN.md](docs/worker-mvp-usage.zh-CN.md)。当前 Brain 可见的 Worker 能力是 `worker.status` 和 `agent.execute`；本地 Worker Agent 只在 runtime policy 允许范围内执行文件和命令操作。

LLM 配置：

```bash
cp .env.example .env
```

Sedna 不再提供产品级 mock LLM provider。请在 Settings 中配置真实 provider，或通过环境变量配置 OpenAI：

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
- Brain 管理的 scope 与 Worker runtime 实际执行策略如何收敛
- Worker Agent 变更类动作的确认规则
- Worker 后台服务安装和离线行为
- 模型/provider 路由和敏感数据处理
- 备份、恢复和迁移

## 开发说明

修改前请先阅读 [AGENTS.md](AGENTS.md)。
