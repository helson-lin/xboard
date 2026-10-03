# 服务端 Docker + GitHub 部署

服务端容器运行 FastAPI、SQLite、yt-dlp 和 ffmpeg，内含管理后台。
公开前端可以单独放在 Cloudflare。R2 继续提供媒体存储，不需要重新上传。

## GitHub 构建镜像

将项目源码（项目根目录是 Dockerfile 所在目录）推送到你的 GitHub 仓库。
`.github/workflows/docker.yml` 会在 main/master 推送、v 开头标签或手动触发时：

1. 在 Python 3.12 下执行后端离线测试。
2. 构建 linux/amd64 镜像，包含自动构建的前端。
3. 启动测试容器，检查健康接口、公开 API、ffmpeg、yt-dlp 和非 root 运行用户。
4. 通过 GitHub 自动提供的 GITHUB_TOKEN 发布到 `ghcr.io/<owner>/<repository>`。

默认分支发布 `latest`，每次提交也有 `sha-<完整提交SHA>`，v 标签发布版本号。
PR 只测试，不推送镜像。无需将 R2 密钥提供给 GitHub Actions。
仓库 Settings → Actions 中需允许工作流使用 `packages: write` 权限。
GHCR 包可能默认为私有；服务器拉取私有镜像时需使用有 `read:packages` 权限的
GitHub PAT 执行 `docker login ghcr.io`，密码通过提示输入。

## 首次部署

服务器需要 Docker Engine 和 Docker Compose v2。可将项目放在 `/srv/xboard`，
目录名称不限。镜像部署只需要 `compose.yaml`、`.env`、`data/` 和 `config/`。

```bash
cd /srv/xboard
cp .env.example .env
chmod 600 .env
sudo install -d -o 10001 -g 10001 -m 700 data config
```

编辑 `.env` 的 `XBOARD_IMAGE` 为你的镜像名，owner/repository 使用小写。
初次部署可用 `:latest`，正式更新建议选定版本号或 sha 标签。

将私有 `storage.json` 放进宿主机 `config/`；容器内对应
`/etc/xboard/storage.json`。数据库在宿主机 `data/xboard.db`，容器内是
`/var/lib/xboard/xboard.db`。配置文件可参考 `config/storage.example.json`。

```bash
sudo chown -R 10001:10001 data config
sudo chmod 600 config/storage.json
docker compose pull api
docker compose up -d --no-build api
docker compose ps
curl --fail http://127.0.0.1:8765/healthz
```

API 默认只绑定服务器的 127.0.0.1。用主机上的 Nginx/Caddy 或 Cloudflare Tunnel
将 HTTPS API 域名代理到 `http://127.0.0.1:8765`。
例如 `https://api.example.com`，后台地址为 `https://api.example.com/admin`。
容器化反向代理应与 API 加入同一 Docker 网络，代理到 `http://api:8765`。

新安装会在首次启动日志输出生成的管理密码与 API Token；可以在自己服务器上
查看 `docker compose logs api`。不要将这些日志或 config 目录上传到 GitHub。
如需使用环境变量管理登录凭据，程序支持 XBOARD_USERNAME / XBOARD_PASSWORD /
XBOARD_API_TOKEN，可通过私有 Compose override 添加，不能作为镜像构建参数。

## 搬迁当前已有数据

先停止旧服务，使用 SQLite backup API 生成一致性备份，并复制整个 `data/` 与
`config/` 到新服务器。**不要只搬媒体或只搬 storage.json**：数据库保存 R2 对象
引用，auth.json、secret.key、api_token.json 保存登录和插件认证配置。
data 中的旧 runtime PID/锁文件不用于容器启动；容器直接运行 uvicorn，不启动 daemon.py。

确认备份完整后设置挂载目录所有权为 10001:10001，再按上面的命令启动。
已有 R2 文件继续复用；配置中的 bucket 和 prefix 保持原值。
同一数据库只运行一个 API 容器、一个 uvicorn worker，避免重复领取后台任务。
迁移或维护期间先等待下载任务完成，容器退出有两分钟宽限期。

## Cloudflare 公开前端连接 API

前端构建时设置 `VITE_PUBLIC_API_BASE_URL=https://api.example.com`。
公开查询、头像/媒体的本地回退地址、素材 ZIP 下载都会使用这个地址。
管理后台仍在 API 域名下，通过同源 Cookie 登录。公开访问不需要管理令牌。
后端已有公开跨域 CORS 支持。

```bash
cd web
npm ci
VITE_PUBLIC_API_BASE_URL=https://api.example.com npm run build
mkdir -p deploy/static
cp -r dist/assets deploy/static/
cp dist/favicon.svg dist/icons.svg deploy/static/
cp dist/public.html deploy/index.html
```

Cloudflare 静态站点的发布目录为 `web/deploy`。首页使用 public.html 的内容，
`/static/assets/` 保持与当前 Vite 构建路径一致。这个步骤准备静态文件，不会自动发布。
VITE_PUBLIC_API_BASE_URL 是公开 URL，不能填写 R2 密钥或管理 Token。

## 本地构建、更新和回退

从完整源码本地构建时，在没有 `.env` 或将 XBOARD_IMAGE 设为 `xboard-api:local`
后运行 `docker compose up -d --build api`。
GitHub 镜像更新时，修改 `.env` 的镜像标签，执行：

```bash
docker compose pull api
docker compose up -d --no-build api
```

Compose 挂载的数据和配置不会因镜像更新丢失。回退使用上一个镜像标签，执行相同命令。
不要运行 `docker compose down -v` 或删除 data/config 来更新服务。

当前工作环境没有 Docker，尚未在此环境实际构建/启动容器；工作流包含真实容器
构建与冒烟测试，需推送至 GitHub 后执行确认。
