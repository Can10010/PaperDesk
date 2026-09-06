# Hermes 接入：让 QQ 中的灵感进入文献库

Hermes 是你已有的对话助手；PaperDesk 提供论文和笔记工具。接通后，你在 QQ 与 Hermes 讨论时，可以让它查文献、读原文，最后把想法追加到笔记。PaperDesk 不负责 QQ 登录，也不会主动发送消息。

## 可以让它做什么

- “在我的文献库查找 DOA estimation 的论文，返回标题、片段和页码。”
- “阅读这篇论文第 3 页，解释实验设置，区分原文结论与你的推测。”
- “把刚才讨论的三个实验想法追加到这篇论文的 Markdown 笔记，保留原有内容。”

PaperDesk 的模型设置可以留空。Hermes 仍可检索、阅读，并使用 Hermes 自己的模型分析。只有 ask_library 工具要求 PaperDesk 自己配置文献问答模型。

## 第一次连接，按四步完成

1. **在 Hermes 所在电脑安装并打开 PaperDesk。** 登录文献账号，导入或手动同步资料。最省事的方案是两个程序在同一台电脑。
2. **在 PaperDesk 设置里生成令牌。** 令牌文件会自动保存，不用手动创建，也不用填写 QQ 密码。若已配置，不必重新生成。更新令牌会让旧令牌失效。
3. **在 Hermes 的 MCP 设置中加入下面配置。** 在 Windows 原生 Hermes 中，通常编辑 HERMES_HOME/config.yaml；不知道位置时先查看 Hermes 的配置目录。只合并 paperdesk 项，保留已有模型、QQ 和其它 MCP 设置。设置页会生成符合本机实际安装路径的配置，可直接复制。
4. **重新加载 Hermes 的 MCP 连接，然后验证。** 让 Hermes “调用 PaperDesk 的 list_papers 列出文献”。能够列出后，再尝试 search_papers 和 read_paper。Windows 原生部署可在终端执行 hermes gateway restart；其它部署请使用原有重启方式。

安装在 D:/Apps/PaperDesk 时：

```yaml
mcp_servers:
  paperdesk:
    command: "D:/Apps/PaperDesk/resources/runtime/node.exe"
    args:
      - "D:/Apps/PaperDesk/resources/app/scripts/hermes-mcp.mjs"
    env:
      PAPERDESK_URL: "http://127.0.0.1:47821"
      PAPERDESK_TOKEN_FILE: "D:/PaperDeskData/hermes-token.txt"
```

访问令牌代表此文献库的读写权限，与应用登录密码不同。不要把令牌发到 QQ 群或写进笔记。PaperDesk 不借用 Hermes 的模型接口或密钥。

## 工具说明

| 工具 | 用途 |
| --- | --- |
| list_papers | 查看文献列表 |
| search_papers | 全文检索论文和笔记，返回来源片段 |
| read_paper | 阅读论文文字，可指定页码 |
| read_note | 阅读 Markdown 笔记 |
| write_note | 默认追加灵感；明确要求时可以覆盖 |
| ask_library | 使用 PaperDesk 问答模型整合来源 |
| import_paper | 导入服务所在电脑上的指定 PDF |

## 不在同一环境时

另一台 Windows 电脑：建议在那里安装 PaperDesk，通过手动同步把资料带过去。同步与即时调用互相独立。

Docker / Linux：命令和脚本路径必须在容器内可访问，Windows 的 D:/ 路径不能直接使用。需要给容器提供 Node 24 和 MCP 脚本，并使用受控连接访问 PaperDesk；不要把本地端口直接公开到互联网。

需要即时访问另一台电脑时，可以建立 SSH 隧道：

```powershell
ssh -N -L 47822:127.0.0.1:47821 researcher@workstation.example
```

然后 MCP 使用 http://127.0.0.1:47822 和远端文献库的访问令牌。隧道不会双向同步资料，也不代替应用的同步配对。

## 排查

无法连接：确认 PaperDesk 后台运行；桌面窗口关闭后后台通常仍在。未授权：检查令牌是否属于当前资料库，不要反复更新令牌。搜索为空：尝试原文关键词，扫描 PDF 先 OCR。导入路径不存在：必须使用 PaperDesk 服务所在电脑能访问的路径。配置修改未生效：重新加载对应 MCP 连接。