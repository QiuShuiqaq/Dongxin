# 运维平台单机试点发布

日期：2026-11-02。运维网页与 API 已部署至现有 ECS，已验证管理员登录、六个页面、访问鉴权及 API 重启后的知识数据保留。当前通过 SSH 隧道访问，尚未开放公网业务入口。实测记录见 [ECS 首次部署记录](../docs/reports/2026-11-02/ECS首次部署记录.md)。

2026-11-09 更新：回环试点已切换至 `20261109T010947Z-55321cb0-dirty`，只读检查通过健康、登录、六个运营板块、设备列表及运行状态；设备入口仍被 Nginx 拒绝。ECS 同机已安装 PostgreSQL 17.11，仅监听本机回环地址，三版迁移已实库执行，应用账号连接及权限检查、隔离恢复演练均通过。**API 的设备、命令、知识等主路径仍是 JSON；数据库当前未接管业务，不得作为量产上线结论。** 本次记录见 [备案等待期验证记录](../docs/reports/2026-11-09-备案等待期验证记录.md)。

## 本次范围

- ECS：杭州，Alibaba Cloud Linux 3，4 核 / 8 GB / 60 GB / 5 Mbps；公网 `121.41.198.198`。
- Node.js 24 LTS、Nginx、systemd 单 API 进程。网页与 `/api/` 同源访问。
- 本轮先部署运维网页和 API；研发中心、电脑串口代理、固件均不在发布包中。
- 域名 `zjdongxin.net` 已购买。2026-11-03 复查注册局 RDAP 状态为 `active`，公共 DNS `1.1.1.1` 已将 `ops.zjdongxin.net` 解析到 `121.41.198.198`；`api.zjdongxin.net` 当时仍为 NXDOMAIN。实名认证状态需在阿里云控制台核对，ICP 备案与 HTTPS 证书仍待办。服务继续只监听回环地址，不开放公网明文登录。临时预览采用受限 SSH 隧道，之后切换正式 HTTPS 入口。
- 当前业务主路径仍使用 JSON，限单实例、小规模样机试点；保留生产门禁及设备数上限。16 是在线任务准入上限，不是实测容量承诺。正式消费者上线前需完成持久化仓储迁移、TLS、设备认证及容量验证。
- 第一轮关闭 MQTT 和公网设备入口，不触发真实设备。后续先按 [MQTT 回环试点](MQTT-LOOPBACK-PILOT.md) 在 ECS 内部启用 Broker 与 API 网关；公网设备接入仍单独验收。安装数据库本身不会完成业务迁移。

## 目录与权限

```text
/opt/dongxin/
  node/                    # 指向安装好的 Node.js 24 目录
  releases/<版本号>/        # 版本代码、网页、该版本 Linux 依赖
  current -> releases/…    # 当前版本
  previous -> releases/…   # 上次成功版本
/etc/dongxin/api.env       # 管理员、设备凭据、AI Key；不随发布覆盖
/var/lib/dongxin/          # 知识库、配置及业务数据；不随发布覆盖
/var/backups/dongxin/      # 更新前的停止服务备份，包含敏感配置
```

`dongxin` 为无登录权限的服务账号。代码只读；该账号可写 `/etc/dongxin` 与 `/var/lib/dongxin`。Nginx 必须能读取网页目录。应用日志交给 journal；控制日志空间并定期检查磁盘。备份需安全下载到本地或其他存储，同机副本不能覆盖整机故障。

## 当前电脑访问

当前地址为 `http://127.0.0.1:8080`。该地址通过 SSH 隧道连接 ECS，并非本地开发服务。账号为 `admin`，初始随机密码保存在本机 `D:\workspace\.ssh\dongxin-ecs-admin-20261102.txt`，文件已限制访问权限，不纳入 Git。

电脑重启或隧道断开后，在 PowerShell 执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\workspace\Dongxin\deploy\open-operations-tunnel.ps1
```

脚本仅监听本机 `127.0.0.1:8080`，严格核验已固定的服务器密钥。若办公公网 IP 变化，需要先调整安全组中 SSH 的来源 IP。停止隧道可结束脚本输出的 SSH 进程，服务器上的平台仍继续运行。

隧道连通后，可在项目根目录运行只读接口检查：

```powershell
node scripts/probe-operations-readonly.mjs http://127.0.0.1:8080/ D:\workspace\.ssh\dongxin-ecs-admin-20261102.txt
```

该脚本仅接受本机回环地址，验证健康、登录鉴权、六个运营板块、设备列表和运行状态；不输出密码或业务记录，不调用 AI，也不发设备指令。它不替代 PostgreSQL、HTTPS/MQTTS 或样机联调验收。

## 本地生成发布包

在项目根目录运行 `npm run deploy:package`，依次检查 API/运维网页类型、构建网页并打包。

产物在 `.artifacts/releases/`：`dongxin-operations-<版本>.tgz` 和 `.sha256`。包内 `release.json` 记录提交号、是否含未提交改动、数据格式版本。`-dirty` 表示包含当前未提交源码，不代表已提交 GitHub。不要直接打包整个工作区或上传本地 `node_modules`。

发布包显式排除 `.env`、运行数据、知识库源文件、硬件代理、固件源码/构建产物、测试源码与 Windows 依赖。仅附带 API 需要的固定唤醒回复 PCM 资源。首次知识数据迁移单独处理：代码内默认知识可初始化，但本地人工修改、审核记录及原始资料不会凭空迁移。

## 首次服务器安装顺序

以下按实际服务器输出逐步执行；不要一次粘贴所有示例。尚未安装 Node 与 Nginx 时，先核对现有服务，再安装 Node.js 24 LTS（验证官方 SHA256）与 Nginx。不要启用 `npm run dev` 或多实例 PM2。

1. 建立服务账号、版本目录、配置与数据目录。安装运行环境；确认 Node 可执行路径 `/opt/dongxin/node/bin/node`。
2. 通过阿里云文件上传功能上传发布包和校验文件。校验 `sha256sum -c <文件>.sha256` 后，解压至新的 `/opt/dongxin/releases/<版本>/`，不得覆盖当前版本。上传工具若不可用，先建立仅允许本人公网 IP 的 SSH 访问，不开放全网 SSH。
3. 在新版本目录内以非 root 的部署账号执行：

   ```bash
   PATH=/opt/dongxin/node/bin:$PATH npm ci --omit=dev --workspace @dongxin/api --workspace @dongxin/mqtt-broker --workspace @dongxin/shared --include-workspace-root=false --no-audit --no-fund
   ```

   `tsx` 是明确的运行依赖；目前 API 并不输出 `dist/index.js`。依赖在 Linux 安装，禁止上传 Windows `node_modules`。

4. 以 `dongxin` 账号执行该版本的 `deploy/configure-pilot.mjs`，交互设置至少 12 字符的管理员密码。命令示例：

   ```bash
   sudo -u dongxin /opt/dongxin/node/bin/node /opt/dongxin/releases/<版本>/deploy/configure-pilot.mjs
   ```

   脚本首次创建 `/etc/dongxin/api.env`，随机生成会话密钥和未配对占位凭据，不回显秘密。管理员名称为 `admin`。若文件已存在则拒绝覆盖。占位凭据不用于真实设备，后续接样机时另行灌装独立设备密钥。

   自动部署时也可由 root 使用 `--generate-password-file /绝对路径/私密文件` 生成随机初始密码；密码只写入新建的 `0600` 文件，不输出到终端。通过安全通道交付后移除服务器上的临时明文副本。运行配置仍需归属 `dongxin:dongxin`，权限 `0600`。

5. 安装 `dongxin-api.service` 到 `/etc/systemd/system/`，执行 `systemctl daemon-reload`、`systemctl enable dongxin-api`。配置文件由 dotenv 加载并写回，不能再通过 systemd `EnvironmentFile` 注入同名密钥。
6. 备份原 Nginx 配置，再安装 `nginx-main.conf` 为 `/etc/nginx/nginx.conf`，`nginx-proxy.conf` 为 `/etc/nginx/dongxin-proxy.conf`，`nginx-loopback.conf` 为 `/etc/nginx/conf.d/dongxin.conf`。主配置不带默认公网站点，启用静态文本 gzip，访问日志不记录查询参数。使用 `nginx -t` 检查后启动或重载 Nginx。若 SELinux 为 Enforcing，按实际拒绝日志配置网页文件标签与反向代理权限，不关闭 SELinux。
7. 执行 `sudo bash /opt/dongxin/releases/<版本>/deploy/activate-release.sh <版本>`。脚本先停止 API 并备份持久目录，再切换版本、启动和检查 `/api/health`；失败时恢复原代码版本。首次安装失败则保持服务停止。
8. 分别检查 API `127.0.0.1:3077/api/health`、代理 `127.0.0.1:8080/api/health` 与网页 `127.0.0.1:8080/`。还要人工验证登录、知识编辑、重启保留数据。只返回健康状态不等于完整验收。

3077、5432、1883、8080 都不直接对公网开放。当前 Nginx 明确阻止 `/api/device/`。域名、备案与可信 HTTPS 配置好后再切换正式入口和 `OPS_CORS_ORIGINS`；设备联调阶段再开放相应 HTTPS 路由及 MQTTS 8883。

系统 journal 已设置持久保存、总空间最多 256 MB、最长保留 14 天；配置模板为 `journald-limits.conf`。Nginx 沿用系统的每日轮转、压缩并保留 10 份日志。上述限制控制日志占用，不包含业务数据和发布备份；备份仍需按实际更新频率检查。

## 域名与 HTTPS

2026-11-02 域名查询曾返回 `client hold`；2026-11-03 注册局 [RDAP](https://rdap.verisign.com/net/v1/domain/zjdongxin.net) 已返回 `active`，公共 DNS 已解析 `ops` 记录。`api` 记录在同一公共 DNS 上仍不存在；设备入口启用前需在阿里云云解析核对、添加并复查。账户内的实名认证状态仍以阿里云「域名控制台 → zjdongxin.net → 域名信息」为准。DNS 正常与 ICP 备案、HTTPS 证书是不同的检查项，不能据此开放公网运维登录。

阿里云云解析 DNS 中为 `zjdongxin.net` 添加以下记录，线路为默认、TTL 使用默认值即可：

| 类型 | 主机记录 | 记录值 | 用途 |
| --- | --- | --- | --- |
| A | ops | 121.41.198.198 | 运维平台 |
| A | api | 121.41.198.198 | 后续设备 API 与 MQTTS，可先解析但暂不开放服务 |

现阶段无需添加 `@`、`www`、邮件或 IPv6 记录。购买域名与 DNS 生效不等于完成 ICP 备案。大陆 ECS 正式公开网站前，先核实企业域名实名认证及 ICP 备案要求，可与内部部署并行处理。

备案和证书就绪后：为 `ops.zjdongxin.net` 安装有效 HTTPS 证书，将证书和私钥放入 `nginx-https.conf` 指定位置，用该模板替换回环入口配置；将 `api.env` 的 `OPS_CORS_ORIGINS` 改为 `https://ops.zjdongxin.net`，重启 API，`nginx -t` 通过后再重载 Nginx。私钥不放进发布包。配置证书到期监测与续签，最后按实际需要开放安全组 443、80；内部员工试点可先仅允许已知办公公网 IP。

网页通过自己的 `/api/` 访问 API，不需要开放 3077。后续 `api.zjdongxin.net` 需要独立配置相应证书和设备认证入口，并让固件信任证书链；仅增加 DNS 记录不会完成设备接入。

## 更新与回滚

每次更新：本地检查并生成新包 → 上传校验 → 解压到新版本目录 → 安装该版本 Linux 依赖 → 运行新版本的 `activate-release.sh` → 检查登录和关键页面。无需重新创建账号或配置文件；本地测试数据不会覆盖服务器数据。

在本机生成新发布包后，可使用统一更新入口；将路径替换为刚刚打包输出的实际文件：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\workspace\Dongxin\deploy\update-operations.ps1 -ArchivePath D:\workspace\Dongxin\.artifacts\releases\dongxin-operations-<版本>.tgz
```

该脚本固定校验服务器身份，先在本地核对包的 SHA256 与版本信息，再上传、在 ECS 再次校验、安装 Linux 生产依赖。正式切换仍调用 `activate-release.sh`，沿用停服备份、健康检查和失败恢复机制。不会自动更新 Nginx、systemd、运行环境或业务配置；这些改动需按相应部署说明单独应用。

只上传与安装、不切换服务时，在上述命令最后增加 `-PrepareOnly`。准备完成后，可在服务器运行输出的激活命令，或者对同一原包再次执行不带 `-PrepareOnly` 的更新命令。已有目录只有在准备完成标记与包 SHA256 相同时才复用，否则拒绝覆盖；准备失败的目录保留用于排查，下次应重新打包生成新版本。旧版本与上传包不会自动删除。凭据与目录约定与本机隧道脚本一致，SSH 来源 IP 仍需符合安全组规则。

应用在停止时等待正在处理的请求，最长 25 秒，systemd 30 秒后兜底终止。单机更新存在短暂中断，更新期间不开展样机动作测试。

回滚：读取 `/opt/dongxin/previous` 的版本号，向 `activate-release.sh` 传入该版本号。回滚同样先备份。脚本只自动回退代码；不会自动恢复或覆盖持久数据。发布若涉及数据格式变更，应递增 `dataFormatVersion` 并先制定迁移与恢复步骤，脚本会拒绝直接跨格式切换。未来 PostgreSQL schema 变更也需单独处理，切换软链接不等于数据库回滚。

保留最近 3 个成功版本，确认 `current`、`previous` 均不引用后再清理旧版本；备份检查可恢复并复制离机后，按保留策略人工清理，不由本脚本自动删除。

常用状态命令：`systemctl status dongxin-api nginx`、`journalctl -u dongxin-api -n 100 --no-pager`、`readlink -f /opt/dongxin/current`。日志和配置可能包含内部信息，反馈排错内容前先删去凭据与用户文本。

## 本地准备验证

2026-11-02 在 Windows / Node.js 22.12.0 环境完成：API 和运维网页类型检查、运维网页生产构建、独立发布包的生产依赖安装、打包 API 在生产配置及试点门禁下启动、未登录请求拒绝、管理员登录和 16 并发配置读取。外置配置并发保存及新进程重新加载的回归测试通过，Bash 脚本语法检查通过。均使用隔离数据与占位凭据，MQTT 关闭，无硬件动作和付费模型调用。

ECS 上的 Node.js 24/Linux、Nginx、systemd、登录、页面与重启保留检查已补充执行，详见部署记录。TLS、公网设备接入、并发容量和部署故障后的自动代码恢复仍未验证。

统一更新入口已在 ECS 实测：`-PrepareOnly` 完成上传、校验及 Linux 依赖安装，期间当前版本与配置、知识文件保持不变；再次运行正式更新命令成功复用准备结果，停服备份并切换至新版本。更新后登录和六个运营页面通过，配置与知识文件校验值不变，最新备份可读且已下载至本机。该结果不包含上传中断、安装失败或新版本启动失败的故障注入测试。
