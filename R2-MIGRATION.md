# R2 媒体与头像迁移

SQLite 继续存推文、标签、备注和任务。媒体记录中的 `path`、推文的
`poster_path` 和 `author_avatar` 改存 `r2://对象路径`；临时签名 URL 只在 API
响应时生成，不写入数据库。未迁移的本地媒体继续正常访问。

## 配置

```bash
python3 -m pip install -r requirements-r2.txt
cp config/storage.example.json config/storage.json
chmod 600 config/storage.json
```

编辑私有 `config/storage.json`，填入 R2 S3 endpoint、bucket 和有对象读写权限的
Access Key ID / Secret Access Key。该文件已加入 `.gitignore`，不要将密钥发到聊天里。
也可通过 `XBOARD_STORAGE_CONFIG` 指向其他私有配置文件，或使用
`XBOARD_STORAGE_BACKEND/ENDPOINT/BUCKET/ACCESS_KEY_ID/SECRET_ACCESS_KEY/PREFIX`
环境变量覆盖对应配置项。

R2 桶保持私有。API 生成 GET 签名链接，让浏览器直接从 R2 获取媒体，默认有效期
一小时。久置页面的签名可能过期，刷新页面重新获取链接即可；`url_ttl` 可调整
到 60–604800 秒。现有公开看板也会获得签名链接，保持原有公开内容访问行为。
R2 CORS 应允许实际看板域名的 GET/HEAD，以及 Range 请求头。

## 历史数据

1. 服务运行时可以执行 `python3 migrate_r2.py` 预览数量和缺失文件，无上传、无数据库修改。
2. 完成所有下载任务，停止 **supervisor 及其 API 子进程**。直接启动的 uvicorn 也需停止。
3. 配置 R2 后执行 `python3 migrate_r2.py --apply`。
4. 执行 `python3 migrate_r2.py --verify`，检查所有引用已转为存在的 R2 对象。
5. 重新启动 Xboard。`backend: r2` 会让新增下载的头像、图片、视频和封面全部上传到 R2。

迁移自动用 SQLite backup API 创建一致性数据库备份，备份和逐条报告位于
`data/backups/`。**所有历史本地文件保留，不自动清理。** 每条推文全部上传并
通过文件长度及 SHA-256 元数据校验后，才在同一个数据库事务中切换引用；失败
推文保留旧引用。进程中断或部分失败后，可以重复 `--apply`，已迁移对象会检查
存在性，匹配内容的上传会跳过。上传成功但数据库未切换的对象可能暂时无引用。

历史头像会从旧外链下载，按 URL 缓存并上传到共享的 avatars 命名空间。若旧头像
失效，会尝试重新获取推文元数据中的新头像地址；仍失败则记录失败并保留该推文
原有引用，不能将其视为迁移完成。纯文字推文的头像也会迁移。

回退时先停止服务，将 `backend` 改为 `local`，使用对应 `pre-r2-*.db` 备份
恢复数据库，再启动服务。本地历史媒体仍在；备份后的新增数据需另外保留，不能
直接覆盖丢弃。R2 对象可以继续保留用于重新迁移。

## 新下载与原有功能

- 新下载使用单独的临时目录；上传校验失败时任务失败，不标记为完成。
- 成功任务提交 R2 引用后清理本次临时目录。失败任务临时文件和头像缓存会保留。
- 开启 `keep_ytdlp_json` 时，原始 yt-dlp JSON 另存本地 `data/metadata/`，避免临时目录清理时丢失；该诊断元数据不属于前端媒体资源。
- 下载素材 ZIP 会从 R2 取回媒体，继续包含 `tweet.txt`。
- 删除推文时同步删除无其他推文引用的 R2 文件；共享头像仍被引用时保留。
- yt-dlp / ffmpeg、数据库和后台任务仍在当前服务器运行。

## 验证

```bash
python3 -m unittest discover -s tests -v
python3 -m compileall -q core app.py migrate_r2.py
```

测试使用模拟 R2 和临时 SQLite，覆盖失败不切换引用、重复迁移、本地原件保留、
新资源上传、签名链接、远程 ZIP 以及共享头像删除。真实云端上传还需配置后的验证。
