# CI 优化：TeX Live 安装缓存改造

**日期**：2026-08-19
**改动文件**：`.github/workflows/deploy.yml`

## 问题

每次 CI 构建通过 `apt-get install` 安装完整的 TeX Live 发行版（`texlive-latex-base`, `texlive-latex-extra`, `texlive-pictures` 等），耗时约 **12-13 分钟**，占整个构建时间的 95% 以上。`apt-get` 层面没有持久化缓存，每次都需要重新下载和安装约 500MB+ 的包。

## 方案

将 `apt-get install texlive-*` 替换为 [TeX-Live/setup-texlive-action@v4](https://github.com/TeX-Live/setup-texlive-action)，这是 TeX Live 官方维护的 GitHub Action，核心特性：

- **默认开启 `TEXDIR` 缓存**（基于 `@actions/cache`），缓存命中时直接恢复，不联网
- **按包安装**，只装项目实际需要的包，不装整个 meta-package
- 缓存 key 基于包列表自动计算，包列表变化时自动刷新缓存

### 选择最小包列表的依据

通过分析项目代码确定实际需要的包：

| 包名 | 原因 |
|------|------|
| `scheme-basic` | 提供 `latex` 引擎、`amsmath`、`amssymb` 等基础功能 |
| `standalone` | `\documentclass{standalone}` — TikZ 编译模板（见 `tikz-tex.mjs`） |
| `pgf` | TikZ 核心（`\usepackage{tikz}` + 所有 `\usetikzlibrary`） |
| `pgfplots` | 笔记中使用了 `\begin{axis}` / `\addplot`（见 `测试 1.md`） |
| `tikz-cd` | 笔记中使用了 `\begin{tikzcd}`（交换图） |
| `chemfig` | 笔记中使用了 `\chemfig`（化学结构式） |
| `simplekv` | `chemfig` 的隐式依赖 |
| `xcolor` | 自动推断包之一（`PACKAGE_HINTS` 规则） |
| `dvisvgm` | DVI → SVG 转换器（编译流水线核心） |
| `preview` | `standalone` 的依赖 |
| `currfile` / `filehook` / `gettitlestring` | `standalone` 的隐式依赖 |
| `tools` | 提供 `array.sty` 等基础包 |
| `iftex` | 多个包的共同依赖 |

Ghostscript 保留为 `apt-get` 安装，因为它是系统级二进制而非 TeX Live 包，安装只需几秒。

## 缓存策略与 GitHub 额度

- GitHub Actions 缓存默认 **10 GB / 仓库**，免费
- 本项目 TeX Live 最小安装约 200-400 MB，远低于上限
- 缓存 7 天未访问才过期；笔记频繁推送不会触发驱逐
- 未开启 `SETUP_TEXLIVE_ACTION_FORCE_UPDATE_CACHE`（官方警告会浪费缓存空间）
- 未开启 `update-all-packages`（避免每次联网更新）

## 预期效果

| 场景 | 耗时 |
|------|------|
| 改造前（apt-get 无缓存） | ~12-13 分钟 |
| 改造后首次（缓存 miss） | ~1-2 分钟 |
| 改造后后续（缓存 hit） | ~10-20 秒 |

## 后续维护：添加新 TeX 包

如果笔记中使用了新的 LaTeX 包（如 `\usepackage{forest}`），只需在 `deploy.yml` 的 `packages:` 列表中添加一行：

```yaml
- name: Install TeX Live (TikZ → SVG)
  uses: TeX-Live/setup-texlive-action@v4
  with:
    packages: |
      scheme-basic
      standalone
      pgf
      ...
      forest        # ← 新增
```

**注意事项**：

1. `tlmgr` 不自动解析依赖。如果新包有隐式依赖，构建会报类似 `! LaTeX Error: File 'xxx.sty' not found` 的错误，将缺失的包名加入列表即可
2. 包列表变化后，缓存 key 自动刷新，该次构建会重新安装（约 1-2 分钟），后续恢复为秒级
3. 旧缓存会在 7 天后自动驱逐，无需手动清理
4. 查找 TeX Live 包名可在 [CTAN](https://ctan.org/) 搜索，或用 `tlmgr search --global --file xxx.sty` 查询

## 参考资料

- [TeX-Live/setup-texlive-action 官方文档](https://github.com/TeX-Live/setup-texlive-action)
- [GitHub Actions 缓存文档](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching)
- [CTeX-org 缓存优化实践](https://github.com/CTeX-org/ctex-kit/commit/c0f49b7)
