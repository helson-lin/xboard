# XBoard

服务端容器化部署、GitHub Actions 构建 GHCR 镜像及独立前端连接方式见
[DOCKER-DEPLOY.md](DOCKER-DEPLOY.md)。

媒体和作者头像支持 Cloudflare R2；历史数据迁移、私有桶配置及回退步骤见
[R2-MIGRATION.md](R2-MIGRATION.md)。数据库仍使用 SQLite。

本地 X（Twitter）推文看板：粘贴链接 → yt-dlp 下载视频 / 抓取图文 → 自动打标签 →
在顶部按分类浏览。单机运行，数据全部落在 `/data/xboard/data/`。

## 启动

```bash
cd /data/xboard
./build.sh            # 安装前端依赖 + 构建 + 部署到 static/
./run.sh              # 默认 8765 端口，PORT=9000 ./run.sh 可改
```

打开 `http://localhost:8765/`（在 Memoh 里点工作区预览链接）。

开发前端时另开一个终端：

```bash
cd web && npm run dev   # http://127.0.0.1:5173，/api 自动代理到 8765
```

## 使用

1. 右上角 **＋ 添加推文**，粘贴一条或多条链接，每行一个：
   - `https://x.com/SpaceX/status/1481651037291225113`
   - `https://twitter.com/NASA/status/755762873331089410`
2. **任务** 里看进度（排队 / 下载 / 转码 / 归类）。
3. 下载完成后自动归类，标签出现在顶部 **分类栏**，点一下就筛选。
4. 点卡片打开详情：内嵌播放器、图片画廊、备注、手动标签、重新归类、删除。

快捷键：`/` 聚焦搜索，`Esc` 关闭弹窗。

## 支持的内容类型

| 类型 | 处理方式 |
| --- | --- |
| 含视频推文 | yt-dlp 下载（ffmpeg 合并音视频），另存封面图 |
| 纯图文推文 | 走公开元数据接口抓原图，单条最多 8 张 |
| 视频 + 图片 | 两者都下，标记为 `视频+图片` |
| 纯文字推文 | 只存文本，标记为 `纯文字` |

## 自动归类

规则在 `config/tag_rules.json`，可在「设置 → 分类关键词规则」里直接编辑并保存，
立即生效，无需重启。归类的三层信号：

1. **分类关键词**（权重 10+）：命中内置 24 个分类之一，如 `AI`、`科技`、`太空`、`财经`、
   `加密货币`、`游戏`、`影视`、`音乐`、`体育`、`搞笑`、`时事`、`政治`、`军事`、`科学`、
   `健康`、`美食`、`旅行`、`汽车`、`动物`、`设计`、`教程`、`职场`、`教育`、`购物`
2. **作者话题标签**（权重 5）：推文里 `#xxx` 直接成为标签
3. **语言与媒体形态**（权重 2–3）：`中文`/`英文`、`视频`/`图片`/`纯文字`、
   `短视频`/`长视频`、`1080P`/`4K`

英文关键词按词边界匹配，避免 `ai` 误命中 `said`。改完规则可点
**重新归类全部** 批量重算（手动标签不会被覆盖）。

## 受限推文 / cookies

公开推文无需登录。遇到敏感或年龄限制内容时，把 Netscape 格式的 cookies 导出到：

```
/data/xboard/config/cookies.txt
```

保存后自动生效，设置面板会显示检测状态。

## 配置项

`config/settings.json`（也可在设置面板改）：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `max_height` | 1080 | 视频分辨率上限 |
| `concurrent_downloads` | 2 | 并发下载数 |
| `auto_tag` | true | 下载后是否自动归类 |
| `max_auto_tags` | 6 | 每篇最多几个分类标签 |
| `keep_ytdlp_json` | true | 保留 yt-dlp 原始元数据 |

## 目录结构

```
xboard/
├── app.py                 FastAPI 路由
├── run.sh                 启动服务（默认 8765）
├── build.sh               构建并部署前端
├── core/
│   ├── config.py          路径与设置
│   ├── db.py              SQLite 存储
│   ├── downloader.py      元数据抓取 + yt-dlp 下载
│   ├── tagger.py          自动归类引擎
│   └── jobs.py            后台任务流水线
├── web/                   前端源码（Vite + React 19 + TS + Tailwind v4）
│   ├── src/
│   │   ├── components/ui/      Watermelon UI 组件（agndex-dashboard registry）
│   │   ├── components/agndex/  主题、Logo、图标
│   │   ├── components/board/   推文卡片、详情面板、筛选栏、添加对话框
│   │   ├── components/layout/  侧边栏、顶栏
│   │   ├── hooks/useBoard.ts   数据与轮询
│   │   ├── lib/                API 客户端、类型、格式化
│   │   └── pages/              看板 / 标签 / 任务 / 设置
│   └── dist/               构建产物
├── static/                 部署后的前端（由 app.py 托管，构建生成）
├── config/
│   ├── tag_rules.json     分类关键词规则
│   ├── settings.json      运行时设置
│   └── cookies.txt        可选登录态
└── data/
    ├── xboard.db          SQLite 数据库
    └── media/<推文ID>/    视频、图片、封面
```

## 已知限制

- **不从时间线批量抓取**：X 的时间线接口需要登录且反爬严格，本看板按链接逐条下载。
  要批量请把链接列表一次性粘贴进来。
- 服务停止后预览链接即失效；长期运行建议用 `run.sh` 配合进程守护。
- 前端为构建产物，改完 `web/src` 后请重跑 `./build.sh` 再刷新页面。
- 元数据来自 X 的公开接口，字段可能随平台调整而变。
