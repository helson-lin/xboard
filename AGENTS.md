# AGENTS.md

给在此仓库工作的编码代理（Claude Code / Codex / omp 等）的约定。设计 UI 前先读本文件。

## 项目速览

- 后端：FastAPI + SQLite，入口 `app.py`；`./run.sh` 起在 8765（`PORT` 可改）。
- 前端：`web/`，Vite + React 19 + TS + Tailwind v4；`npm --prefix web run dev` 代理到 8765。
- 产物：`./build.sh`（或重建镜像）把 `web/dist` 同步到 `static/`，后端才会用新前端。
- 检查：`npx tsc -b`、`npm run lint`、`python3 -m unittest discover -s tests`、
  `npx markdownlint-cli2 "*.md"`。

## 看现状再改设计

不要凭记忆画 UI。改任何界面前，先拿到当前实现的真实截图：

```bash
npm --prefix web run design:shots            # 需本机有 Chrome，且服务在 8765
npm --prefix web run design:shots -- --base http://nas:8765 --cookie "$XBOARD_SESSION"
```

输出：`design/latest/`（已 gitignore）

- `manifest.json`：每次截图的 `shot / theme / viewport / file / 宽高 / 抓取时间`
- `board-{light,dark}-desktop.png`、`tags-*`、`jobs-*`、`settings-*`
- `board-light-mobile.png`、`tags-light-mobile.png`、`jobs-light-mobile.png`、`settings-light-mobile.png`
- `detail-light-desktop.png`（推文详情）、`add-post-light-desktop.png`（添加推文弹窗）

用法：先读 `manifest.json`，再按需打开对应 PNG（不要一次全读）。截图代表**当前实现**，
改完后重跑一次对比，别把旧图当设计稿。

## 视频与动效

代理默认只看静态帧，所以：

- 页面动效/交互录制：用代理自带浏览器录制（omp 为 `recordStart/recordStop`，
  产出 mp4/webm + 关键帧拼图），或 Playwright 全量包 `recordVideo`。
- 已有视频要"看"：抽帧，别塞整段视频。

```bash
# 每 0.5 秒一帧，缩到 640 宽，最多 12 帧
ffmpeg -i clip.webm -vf "fps=2,scale=640:-1" -frames:v 12 design/latest/clip-%02d.png
```

## 归档素材（真实内容）

设计卡片/详情页时如果需要在真实图片、视频上验证（尺寸、比例、空态）：

```bash
ls data/media | head                                  # 每条推文一个目录
find data/media -name '*.jpg' -o -name '*.png' | head -20
ffmpeg -i "data/media/<id>/video.mp4" -vf "fps=1/3,scale=480:-1" -frames:v 6 design/latest/<id>-%02d.jpg
```

- 存储后端是 R2 时，本地 `data/media` 可能为空：先按
  [R2-MIGRATION.md](R2-MIGRATION.md) 下载，或从 `/public/posts` 拿媒体 URL 再下载。
- 这些内容属于用户库，**不要**提交到仓库，也不要把截图里的真实推文当测试数据写进断言。

## 不要做

- 不要提交 `design/`、`static/`、`data/`、`config/*.json`（凭据）。
- 不要为截图给后端加"演示路由"或放松鉴权；用 `create_token()` 或 API Token 即可。
