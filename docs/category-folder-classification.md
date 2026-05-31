# 功能文档：基于 `category` 的笔记文件夹分类

## 背景

为了让上线后的笔记结构更适合维护和展示，项目新增了一个分类能力：
通过笔记 frontmatter 中的 `category` 属性，生成对应的文件夹分类路径。

该能力适用于希望“展示分类”和“磁盘存储路径”解耦的场景。

## 目标

- 让笔记可以通过元数据控制分类
- 支持最多三级文件夹分类
- 保留原有文件路径分类逻辑作为兜底
- 避免分类路径与文件名重复导致的层级冗余

## 配置规则

在 Markdown frontmatter 中增加 `category` 字段：

```yaml
---
title: 线性代数
category: 学习/数学/代数
---
```

### 规则约束

- 使用 `/` 作为层级分隔符
- 最多支持 3 级
- 每级内容会去除首尾空格
- 空值或非法值会被忽略

## 处理逻辑

### 1. 解析 frontmatter

构建阶段读取 Markdown 文件后，会先解析 frontmatter，提取 `category` 字段。

### 2. 转换为分类路径

系统会把 `category` 拆分为路径段，并进行规范化：

- `学习` → `学习`
- `学习/数学` → `学习/数学`
- `学习/数学/代数` → `学习/数学/代数`

### 3. 写入 `folderPath`

解析后的分类路径会写入笔记元数据中的 `folderPath`，后续文件树和页面生成会优先使用它。

### 4. 文件名去重

如果 `category` 的最后一级与文件名相同，会自动去掉最后一级，避免重复层级。

例如：

- 文件名：`代数.md`
- `category: 学习/数学/代数`

最终会按 `学习/数学` 处理，而不是生成 `学习/数学/代数/代数`。

## 代码落点

### Markdown 解析阶段

在 `quartz/processors/parse.ts` 中：

- 读取 frontmatter
- 提取 `category`
- 规范化为 folder path
- 写入 `file.data.folderPath`

### 文件树阶段

在 `quartz/util/fileTrie.ts` 中：

- 插入节点时优先使用 `folderPath`
- 如果存在 `folderPath`，就按该路径构建文件夹层级
- 否则仍沿用原始 `slug` 路径

## 兼容性

- 未配置 `category` 的笔记：行为不变
- 原有文件路径仍然有效
- 只影响分类组织，不影响 Markdown 内容本身

## 建议用法

建议把 `category` 作为“逻辑分类”，而不是物理路径：

```yaml
---
title: 某篇笔记
category: 学习/数学/代数
---
```

这样后续即使文件移动了，展示分类也可以保持稳定。

## 后续维护建议

如果以后要扩展该功能，建议优先关注以下位置：

- `quartz/processors/parse.ts`：前置解析逻辑
- `quartz/util/fileTrie.ts`：文件夹树构建逻辑
- `quartz/util/ctx.ts`：构建期数据结构

如果要新增更多类似分类字段，建议保持统一的数据模型，不要把规则分散到多个页面组件中。
