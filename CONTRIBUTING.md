# 参与 PaperDesk

欢迎报告可复现的问题、改进文档或提交 Pull Request。

1. Fork 后创建功能分支，例如 `codex/fix-search`。
2. 按 README 安装 Node.js 24 和依赖，使用独立的 `PAPERDESK_DATA_DIR` 开发。
3. 数据模型、同步或权限变更应包含相应的行为测试。界面调整请说明验证过的布局。
4. 提交前运行 `npm test` 与 `npm run build`。
5. Pull Request 说明问题、最终行为、验证结果和兼容性影响。

只提交源码与合成测试资料。不要提交 PDF、个人笔记、数据库、同步包、访问令牌或真实模型密钥。测试目录由测试自己创建并清理；不要让测试读写正式资料库。

公开问题中仅保留脱敏的日志和截图。若发现可泄露资料或绕过权限的问题，请使用仓库 Security 页的私密漏洞报告入口（启用时）；入口不可用时先发不含复现细节的 Issue 请求私下联系。

贡献的代码使用本项目的 MIT 许可证；引用第三方代码时保留其署名和许可证。

## 发布 Windows 版本

维护者可在 GitHub Actions 中手动运行 Build Windows release。它从当前选定分支构建，通过测试后生成安装程序、ZIP 和 SHA-256 清单，并核对上传文件的哈希后发布。已公开的同版本 Release 不会被覆盖；新版本需先更新 package.json 与 package-lock.json 的版本号。构建只使用仓库源码和公开依赖，无需上传本机资料或设置个人访问令牌。
