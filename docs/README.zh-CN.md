# Sedna 文档中心

[English](README.md) | [简体中文](README.zh-CN.md)

本目录包含 Sedna 当前的产品、架构和运行文档。建议从以下入口开始阅读，不要把每个文件当成彼此独立、同等权威的规格。

## 事实来源顺序

文档内容重叠时，按以下顺序判断：

1. [私人 Agent 设计检查点](personal-agent-design-checkpoint.md)定义当前产品方向和全局架构边界。
2. [Brain MVP 设计](brain-mvp-design.md)定义第一阶段可实现的中央大脑范围。
3. 各专项 MVP 设计细化单个子系统，但不能覆盖前两个文档的约束。
4. 使用说明描述已经实现的操作流程。如果说明与代码不一致，以代码当前行为为准，并在同一次变更中修正文档。

这些文档是持续维护的设计检查点，不是冻结的最终规格。产品方向发生变化时，必须同步更新设计检查点和受影响的专项文档。

## 文档地图

### 产品与核心架构

| 文档 | 职责 |
| --- | --- |
| [私人 Agent 设计检查点](personal-agent-design-checkpoint.md) | 产品定位、中央大脑权威、规范图归属、分布式 Worker、隐私、安全和长期方向。 |
| [Brain MVP 设计](brain-mvp-design.md) | 可实现的 MVP 范围、仓库边界、数据模型、API、Web UI、Worker 定位和验收标准。 |

### 专项 MVP 设计

| 文档 | 职责 |
| --- | --- |
| [LLM Integration MVP](llm-integration-mvp.md) | Provider 边界、会话流、上下文、Prompt、隐私和失败处理。 |
| [Dynamic LLM Configuration](dynamic-llm-config-design.md) | Provider 预设、模型路由、Secret、设置和审计。 |
| [Agent Runtime MVP](agent-runtime-mvp-design.md) | 图原生 Agent 循环、上下文、内部动作、观察、确认和策略。 |
| [Agent Workbench UI](agent-workbench-ui-design.md) | 时间线、Agent 活动、记忆、图、任务、设置和 UI 数据流。 |
| [Internationalization MVP](i18n-mvp-design.md) | 英文与简体中文 UI、回复语言、存储和 API 边界。 |
| [MCP And Skills MVP](mcp-and-skills-mvp-design.md) | MCP host/client、工具注册、Skills、策略、Runtime 集成和 UI。 |
| [消息渠道 MVP](message-channels-mvp.zh-CN.md) | 钉钉和飞书/Lark 适配器、Owner 配对、渠道策略、去重和审计。 |

### 运行说明

| English | 简体中文 | 内容 |
| --- | --- | --- |
| [Worker MVP Usage](worker-mvp-usage.md) | [Worker MVP 使用说明](worker-mvp-usage.zh-CN.md) | 启动和配对本地 Worker、路径范围、任务、结果与排查。 |
| [Messaging Channels MVP](message-channels-mvp.md) | [消息渠道 MVP](message-channels-mvp.zh-CN.md) | 配置、绑定和安全运行钉钉及飞书/Lark 渠道。 |

消息渠道文档目前同时承担专项边界和运行说明两个职责。只有在两个读者群确实需要不同内容时再拆分。

## 当前交付顺序

MVP 的实际依赖顺序是：

1. Brain 基础：API、SQLite schema、会话时间线、候选记忆和图查询。
2. LLM provider 边界和动态真实 provider 配置。
3. 带安全内部工具的 Agent Runtime 循环。
4. React Agent Workbench。
5. 语言和模型 provider 设置。
6. MCP/Skills 注册与保守的工具执行。
7. Worker 执行：配对码、带凭据的心跳、策略同步、受限任务、事件和审计。
8. 带 Owner 配对、去重和审计的钉钉与飞书/Lark 渠道。
9. 在 Brain 循环和 Worker guardrail 稳定后扩展分布式执行。

这个顺序描述依赖关系，不代表排在前面的能力都已经完成。

## 文档维护规则

- 仓库级定位变化时，同时维护根目录的[英文 README](../README.md)和[简体中文 README](../README.zh-CN.md)。
- 产品方向统一写入设计检查点，使用说明中不要重复大段架构解释。
- 子系统边界变化时，在同一次变更中更新专项设计及其 API、数据模型示例。
- 双语说明必须同时更新两个语言版本。
- 使用仓库相对链接，并在提交前验证链接。
- 文档示例不得包含凭据、Owner 身份、私有记忆、运行时数据库或真实产物。
- 明确标注未来能力，不要把计划行为写成已实现行为。

## 第一阶段 MVP 非目标

- 不受控的命令执行
- 无边界的文件写入自动化
- 发送邮件
- 浏览器控制
- 支付、账户或生产环境操作
- 自主执行高风险外部动作
- 完整的多 Worker 编排
- 把 Sedna 暴露为 MCP server
