# PaperDesk

本地优先的文献与 Markdown 笔记管理桌面应用，面向 Windows x64。简洁的深色工作区，让论文阅读、研究笔记和知识检索放在一起。

无需邮箱，自设用户名和非空密码，支持记住登录。模型接口可以留空；整理文献、阅读、写笔记与关键词检索均可离线使用。

## 功能

- **文献整理**：导入 PDF，按文件内容与 DOI 去重，自动识别标题并命名。
- **专注阅读**：全屏、可收起侧栏和列表；阅读、独立写作、边读边记三种布局。
- **Markdown 笔记**：阅读笔记与独立笔记、预览、文献链接，笔记文件可用 Obsidian 编辑。
- **知识库**：同时搜索论文与笔记；可选模型问答、检索词扩展与语义检索，回答带来源。
- **手动多设备同步**：SSH 或加密共享文件夹；首次使用同一应用账号密码配对，可记住设备，退出时提醒同步。
- **Hermes / MCP**：提供检索、阅读、追加笔记等工具，让已有助手调用文献库。

## 安装与使用

从 [Releases](https://github.com/Can10010/PaperDesk/releases) 下载 Windows x64 安装程序或免安装 ZIP。安装程序允许自选安装目录，例如 `D:/Apps/PaperDesk`。

第一次打开时创建账号。默认资料库在 `D:/PaperDeskData`；没有 D 盘时使用用户主目录下的 `PaperDeskData`。实际位置可在设置中查看。升级与卸载不会主动删除资料库。

- [使用说明](docs/使用说明.md)：导入、阅读、笔记、同步与备份
- [模型配置指南](docs/MODELS.md)：服务商、模型实例与研究任务
- [Hermes 接入指南](docs/HERMES.md)：用途、配置、工具与排查

## 从源码运行

准备 Windows x64、Git 和 **Node.js 24 x64**（包含 npm），在希望存放工程的位置执行：

```powershell
git clone https://github.com/Can10010/PaperDesk.git
cd PaperDesk
npm ci
npm exec install-electron
npm run prepare:runtime
npm run build
npm start
```

`prepare:runtime` 下载对应版本的 Node 许可证，并将当前 Node 可执行文件复制到工程的 `runtime/node.exe`，桌面应用需要它启动本地后台。Electron 的可执行文件通过 `install-electron` 下载。

开发时可为测试资料单独指定目录和端口：

```powershell
$env:PAPERDESK_DATA_DIR = Join-Path $PWD '.dev-data'
$env:PAPERDESK_PORT = '47831'
npm run build
npm start
```

修改界面后重新执行 `npm run build` 并重新打开窗口。关闭桌面窗口后，后台继续运行以供 Hermes 使用；修改服务端代码时需停止使用该测试目录的旧后台再启动。

## 验证与打包

```powershell
npm test
npm run build
npm run package
```

测试使用临时资料库、合成 PDF 和模拟模型接口，不需要个人论文、真实密钥或远程电脑。可选 PDF 回归测试通过 `PAPERDESK_TEST_PDF_DIR` 指向自己的测试目录；不设置时跳过。

打包前先完成 `npm run prepare:runtime`。产物位于 `release/`，包括安装程序和免安装 ZIP。当前桌面打包与 SSH 远端适配面向 Windows x64；未提供 macOS / Linux 桌面安装包。

## 数据与已知边界

资料保存在本机 SQLite、PDF 和 Markdown 文件中。仓库仅包含应用源码、文档和合成测试，不包含用户文献、账号、模型密钥、同步目标或资料库备份。

SSH 同步需要系统 SSH 密钥连接，并另外验证 PaperDesk 账号。共享文件夹方式写入加密同步包，网盘传输由网盘客户端完成。请先等待文件传输结束，再在另一台设备手动同步。同步不能代替独立备份。

扫描 PDF 需先用外部 OCR 添加文字层。模型接口启用后，相关文献或笔记片段会发送到你选择的服务商。允许简单密码，但它对加密包离线猜测的保护较弱；详情见使用说明。

## 参与与许可

欢迎通过 [Issues](https://github.com/Can10010/PaperDesk/issues) 反馈问题，提交前请移除账号、令牌、文献原文和私人路径。贡献代码见 [CONTRIBUTING.md](CONTRIBUTING.md)。

本项目使用 [MIT 许可证](LICENSE)。第三方依赖遵循各自许可证。模型配置的组织方式参考 [MaiBot 官方指南](https://docs.mai-mai.org/manual/configuration/model-config)，研究任务按文献与笔记用途设计；PaperDesk 与 Obsidian、MaiBot、Hermes 没有隶属关系。
