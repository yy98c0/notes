# notes

个人笔记与数字花园，基于 [Quartz](https://github.com/jackyzha0/quartz) 构建，部署于 [yy98c0.github.io/notes](https://yy98c0.github.io/notes)。

## 本地开发

```bash
npm ci
npx quartz plugin install
npx quartz build --serve
```

浏览器访问 `http://localhost:8080` 预览站点。

## 目录说明

| 路径 | 用途 |
|------|------|
| `content/` | 笔记与文章（Markdown） |
| `quartz.config.yaml` | 站点配置（主题、插件、域名等） |
| `quartz/` | Quartz 静态站点生成器引擎 |
| `quartz.lock.json` | 社区插件版本锁定 |

## 部署

推送到 `v5` 分支会触发 GitHub Actions（`.github/workflows/deploy.yml`），自动构建并发布到 GitHub Pages。

## 许可

Quartz 引擎采用 [MIT License](LICENSE.txt)。站点内容版权归作者所有。
