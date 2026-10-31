# 在测试服 108 上执行。由 tools/release-test-server.sh 经 ssh 标准输入送过来，不要在本机直接跑。
# 全部逻辑放在函数里，最后一行把标准输入换成 /dev/null 再执行，
# 这样 pnpm 等子进程读不到后面的脚本内容（bash -s 的老坑）。
set -euo pipefail

R=/opt/doushisi
APP=${R}/app
NEXT=${R}/app.next
BK=${R}/release-backups
RELEASES=${R}/releases
DATA=/var/lib/doushisi
NGINX=/etc/nginx/sites-available/doushisi
GATEWAY=.local/tunnel/game-proxy.cjs
PUBLIC=https://108.186.180.130
export PATH=${R}/runtime/bin:${PATH}

say() { printf '\n== %s\n' "$*"; }
die() { printf '\n!! %s\n' "$*" >&2; exit 1; }

# 经本机 nginx 走一遍公网路径（--resolve 让请求不出服务器），只取状态码。
curl_code() { curl -sk -o /dev/null -w '%{http_code}' --max-time 20 --resolve 108.186.180.130:443:127.0.0.1 "$@" || true; }
curl_body() { curl -sk --max-time 20 --resolve 108.186.180.130:443:127.0.0.1 "$@" || true; }

wait_health() {
  local url=$1 limit=$2 waited=0
  while [ "${waited}" -lt "${limit}" ]; do
    if curl -fsS --max-time 5 "${url}" 2>/dev/null | grep -q '"status":"ok"'; then return 0; fi
    sleep 2; waited=$((waited + 2))
  done
  return 1
}

# 公网网关只放行白名单路径。大厅接口和头像图片是 10-30 加的（R1、R9）；
# 管理后台 10-31 起对公网开放（DEC-20261031-后台对公网开放）。每段各自判断，已补过的跳过。
# 第二个参数为 check 时只检查不写。退出码 2 = 原文和预期不一致，什么都没改。
patch_gateway() {
  node - "$1" "${2:-write}" <<'JS' || return
const fs = require('node:fs');
const [file, mode] = process.argv.slice(2);
const steps = [
  { label: '/api/lobby/ 和 /media/avatars/',
    before: String.raw`/^\/api\/(me|games|friends|records|rooms)(\/|$)/.test(pathname);`,
    after: String.raw`/^\/api\/(me|games|friends|records|rooms|lobby)(\/|$)/.test(pathname) ||
    pathname.startsWith('/media/avatars/');`,
    also: [String.raw`/^\/api\/(me|games|friends|records|rooms|lobby|social)(\/|$)/.test(pathname) ||
    pathname.startsWith('/media/avatars/');`] },
  { label: '管理后台 /admin/ 和 /api/admin/',
    before: String.raw`/^\/api\/auth\/(register|login|logout)$/.test(pathname) ||`,
    after: String.raw`/^\/api\/auth\/(register|login|logout)$/.test(pathname) ||
    pathname.startsWith('/admin/') || pathname.startsWith('/api/admin/') ||` },
  // 第二轮加过 /api/social/（好友、私聊、邀请）；第三轮 R1 好友整块去掉，白名单里再拿掉。
  { label: '去掉 /api/social/',
    before: String.raw`/^\/api\/(me|games|friends|records|rooms|lobby|social)(\/|$)/.test(pathname) ||`,
    after: String.raw`/^\/api\/(me|games|friends|records|rooms|lobby)(\/|$)/.test(pathname) ||` },
];
let text = fs.readFileSync(file, 'utf8');
const todo = [];
// 按顺序在内存里逐步替换：后面的步骤以前面改过的文字为准。
for (const step of steps) {
  if ([step.after, ...(step.also ?? [])].some(done => text.includes(done))) { console.log('网关白名单已含 ' + step.label); continue; }
  if (text.split(step.before).length !== 2) { console.error('网关白名单和预期不一致，没有改动（' + step.label + '）：' + file); process.exit(2); }
  text = text.replace(step.before, () => step.after);
  todo.push(step);
}
if (mode === 'check') { for (const step of todo) console.log('网关白名单可以补上 ' + step.label); process.exit(0); }
if (todo.length) fs.writeFileSync(file, text);
for (const step of todo) console.log('网关白名单已补上 ' + step.label);
JS
  if [ "${2:-write}" = write ]; then node --check "$1"; fi
}

# nginx 全站请求体上限是 64k；头像照片缩到 512 像素后常有 50–120KB，只给上传这一条放宽。
# 服务器上的配置 10-18 改过证书链，所以只在原文件里插一段，不拿本地副本覆盖。
patch_nginx() {
  node - "${NGINX}" "${1:-write}" <<'JS'
const fs = require('node:fs');
const [file, mode] = process.argv.slice(2);
const text = fs.readFileSync(file, 'utf8');
if (text.includes('location = /api/me/avatar')) { console.log('nginx 已有头像上传段'); process.exit(0); }
const anchor = '    location / {\n';
if (text.split(anchor).length !== 2) { console.error('nginx 配置里找不到唯一的 location /，没有改动'); process.exit(2); }
if (mode === 'check') { console.log('nginx 可以插入头像上传段'); process.exit(0); }
const block = [
  '    # 头像上传单独放宽：客户端已缩到 512 像素，服务端自己限 5MB（tools/release-test-server.sh 加）。',
  '    location = /api/me/avatar {',
  '        client_max_body_size 6m;',
  '        proxy_pass http://127.0.0.1:3003;',
  '        proxy_http_version 1.1;',
  '        proxy_set_header Host 127.0.0.1:3003;',
  '        proxy_set_header Connection "";',
  '        proxy_set_header Forwarded "";',
  '        proxy_set_header X-Forwarded-For "";',
  '        proxy_set_header X-Forwarded-Host "";',
  '        proxy_set_header X-Forwarded-Proto "";',
  '        proxy_read_timeout 60s;',
  '        proxy_send_timeout 60s;',
  '    }',
  '',
].join('\n');
fs.writeFileSync(file, text.replace(anchor, () => block + anchor));
console.log('nginx 已给 /api/me/avatar 放宽到 6m');
JS
}

# 和 10-09 安装时一样只装服务端；sharp 用 @img/sharp-* 预编译包，不跑安装脚本。
write_workspace() {
  cat > "$1/pnpm-workspace.yaml" <<'WORKSPACE'
packages:
  - apps/server
  - packages/*
onlyBuiltDependencies:
  - esbuild
  - protobufjs
allowBuilds:
  esbuild: true
  protobufjs: true
  sharp: false
WORKSPACE
}

start_services() {
  systemctl start doushisi-game
  wait_health http://127.0.0.1:3000/health 180 || return 1
  systemctl start doushisi-public
  wait_health http://127.0.0.1:3003/health 30
}

self_check() {
  local native=$1 fail=0
  check() {
    if [ "$3" = "$2" ]; then printf '  ok  %s\n' "$1"; else printf '  !!  %s：期望 %s，实际 %s\n' "$1" "$2" "$3"; fail=1; fi
  }
  say "自检（经本机 nginx 走公网路径）"
  check "健康检查" ok "$(curl_body "${PUBLIC}/health" | sed -n 's/.*"status":"\([a-z]*\)".*/\1/p')"
  check "游戏页 /client/" 200 "$(curl_code "${PUBLIC}/client/")"
  check "热更新包是这次的版本" "${native}" "$(curl_body "${PUBLIC}/client/native/manifest.json" | sed -n 's/.*"sha256": *"\([0-9a-f]*\)".*/\1/p')"
  check "大厅接口过网关（未登录应 401）" 401 "$(curl_code "${PUBLIC}/api/lobby/tables")"
  check "头像图片过网关（不存在应跳默认图 302）" 302 "$(curl_code "${PUBLIC}/media/avatars/none.jpg")"
  check "100KB 头像上传过 nginx（未登录应 401，不是 413）" 401 "$(head -c 102400 /dev/zero | curl_code -X POST -H 'Content-Type: image/jpeg' --data-binary @- "${PUBLIC}/api/me/avatar")"
  check "管理后台页面对公网开放" 200 "$(curl_code "${PUBLIC}/admin/")"
  check "后台接口过网关（未登录应 401）" 401 "$(curl_code "${PUBLIC}/api/admin/me")"
  local apk; apk=$(curl_code -I "${PUBLIC}/doushisi.apk")
  if [ "${apk}" = 200 ]; then printf '  ok  安装包下载\n'; else printf '  ??  安装包下载返回 %s（不影响后端，换包用 --apk）\n' "${apk}"; fi
  [ "${fail}" = 0 ]
}

# 发布中途出错：切换前出错只还原 nginx、把停掉的服务拉起来；切换后出错把旧目录换回去。
# 数据库不自动回滚：010 迁移只加表加列，旧版照常读写。
on_exit() {
  local status=$?
  [ "${status}" -eq 0 ] && return 0
  trap - EXIT
  set +e
  if [ "${SWITCHED:-0}" = 1 ]; then
    say "发布失败，自动换回旧版"
    systemctl stop doushisi-public doushisi-game
    mv "${APP}" "${R}/app.failed-${STAMP}" && mv "${PREV}" "${APP}"
  fi
  if [ -n "${NGINX_BACKUP:-}" ]; then
    cp -a "${NGINX_BACKUP}" "${NGINX}" && nginx -t && systemctl reload nginx && echo "nginx 已还原"
  fi
  if [ "${STOPPED:-0}" = 1 ] || [ "${SWITCHED:-0}" = 1 ]; then
    if start_services; then echo "旧版已恢复运行"; else echo "旧版也没起来，请把上面的全部输出发给 Claude"; fi
  fi
  if [ "${SWITCHED:-0}" = 1 ]; then
    echo "数据库保持发布后的状态（旧版能用）。要连数据一起回到发布前："
    echo "  bash tools/release-test-server.sh --rollback ${STAMP} --with-db"
  fi
  exit "${status}"
}

release() {
  local sha=$1 commit=$2 native=$3
  local tgz=${RELEASES}/doushisi-app-${STAMP}.tgz bk=${BK}/${STAMP}
  PREV=${R}/app.prev-${STAMP}

  say "校验上传包"
  printf '%s  %s\n' "${sha}" "${tgz}" | sha256sum -c -
  [ "$(df -Pm "${R}" | awk 'NR==2 {print $4}')" -gt 2048 ] || die "磁盘剩余不到 2GB"
  [ -d "${APP}/.local/tunnel" ] || die "找不到 ${APP}/.local/tunnel"
  [ ! -e "${PREV}" ] || die "${PREV} 已经存在"
  patch_gateway "${APP}/${GATEWAY}" check
  patch_nginx check

  say "旁边预装新版到 ${NEXT}（线上服务照常运行）"
  rm -rf "${NEXT}"
  install -d -m 755 "${NEXT}"
  tar --no-same-owner -xzf "${tgz}" -C "${NEXT}"
  cp -a "${APP}/.local" "${NEXT}/.local"
  write_workspace "${NEXT}"
  (cd "${NEXT}" && pnpm install --prod --no-frozen-lockfile)
  (cd "${NEXT}/apps/server" && node --input-type=module -e "
await import('@dss/rules'); await import('@dss/protocol'); await import('@electric-sql/pglite'); await import('./dist/app.js');
const sharp = (await import('sharp')).default;
const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#808080' } }).jpeg().toBuffer();
if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('sharp 没有输出 JPEG');
console.log('依赖可用：服务端代码、规则包、协议包、pglite、sharp ' + sharp.versions.sharp + '（libvips ' + sharp.versions.vips + '）');
")
  patch_gateway "${NEXT}/${GATEWAY}"
  printf 'commit=%s\nstamp=%s\n' "${commit}" "${STAMP}" > "${NEXT}/RELEASE"
  # 10-09 解出来的 .local/tunnel 是 666，服务只需要读。
  chmod -R go-w "${NEXT}/.local"
  chmod -R a+rX "${NEXT}"

  say "备份 nginx 配置，插入头像上传段"
  install -d -m 700 "${BK}" "${bk}"
  cp -a "${NGINX}" "${bk}/nginx-doushisi"
  NGINX_BACKUP=${bk}/nginx-doushisi
  patch_nginx
  nginx -t
  systemctl reload nginx

  say "停服"
  STOPPED=1
  systemctl stop doushisi-public doushisi-game

  say "备份数据库到 ${bk}/database.tgz"
  if [ -f "${DATA}/database.verified.json" ]; then
    tar -C "${DATA}" -czf "${bk}/database.tgz" database database.verified.json
  else
    tar -C "${DATA}" -czf "${bk}/database.tgz" database
  fi
  chmod 600 "${bk}/database.tgz"
  du -h "${bk}/database.tgz" | cut -f1

  say "换目录：旧版留在 ${PREV}"
  mv "${APP}" "${PREV}"
  SWITCHED=1
  mv "${NEXT}" "${APP}"

  say "启动新版（会先自动备份并补跑数据库迁移）"
  start_services || die "服务没有按时起来"
  STOPPED=0
  self_check "${native}" || die "自检没过"
  SWITCHED=0
  NGINX_BACKUP=

  say "发布完成：${commit}（批次 ${STAMP}）"
  echo "旧版目录 ${PREV}，数据库和 nginx 备份在 ${bk}"
}

check_only() {
  local ok=1
  say "服务状态"; systemctl is-active doushisi-game doushisi-public nginx || ok=0
  say "线上版本"; cat "${APP}/RELEASE" 2>/dev/null || echo "（10-09 安装的版本，没有 RELEASE 标记）"
  say "磁盘"; df -h "${R}" | tail -1
  say "运行时"; echo "node $(node -v)，pnpm $(pnpm -v)"
  say "网关"; patch_gateway "${APP}/${GATEWAY}" check || ok=0
  say "nginx"; patch_nginx check || ok=0
  say "npm 源"; echo "registry.npmjs.org 返回 $(curl -s -o /dev/null -w '%{http_code}' --max-time 10 https://registry.npmjs.org/sharp || true)"
  say "已有的发布备份"; ls -d "${R}"/app.prev-* "${BK}"/* 2>/dev/null || echo "无"
  say "健康"; curl -fsS --max-time 10 http://127.0.0.1:3003/health || ok=0; echo
  [ "${ok}" = 1 ] || die "预检没过，看上面标出的项"
  say "服务器预检通过"
}

apk() {
  local sha=$1 up=${DATA}/downloads/doushisi.apk.upload dest=${DATA}/downloads/doushisi.apk bk=${BK}/apk-${STAMP}
  say "校验安装包"
  printf '%s  %s\n' "${sha}" "${up}" | sha256sum -c -
  install -d -m 700 "${BK}" "${bk}"
  if [ -f "${dest}" ]; then cp -a "${dest}" "${bk}/doushisi.apk"; fi
  chown doushisi:doushisi "${up}"
  chmod 600 "${up}"
  mv "${up}" "${dest}"
  local size length
  size=$(stat -c %s "${dest}")
  length=$(curl -skI --max-time 20 --resolve 108.186.180.130:443:127.0.0.1 "${PUBLIC}/doushisi.apk" | tr -d '\r' | awk 'tolower($1) == "content-length:" {print $2}')
  [ "${length}" = "${size}" ] || die "下载地址返回的大小 ${length:-无} 和文件 ${size} 不一致"
  say "安装包已换好：${PUBLIC}/doushisi.apk（${size} 字节）"
  if [ -f "${bk}/doushisi.apk" ]; then echo "旧包在 ${bk}/doushisi.apk；要换回：cp -a ${bk}/doushisi.apk ${dest}"; fi
}

# 只补公网网关白名单，重启网关进程（doushisi-public，在线玩家会断线重连一次），游戏服务不停。
# 网关没起来或自检不过，就换回原文件。
gateway() {
  local file=${APP}/${GATEWAY} bk=${BK}/gateway-${STAMP} fail=0
  patch_gateway "${file}" check
  say "备份网关到 ${bk}"
  install -d -m 700 "${BK}" "${bk}"
  cp -a "${file}" "${bk}/game-proxy.cjs"
  patch_gateway "${file}"
  say "重启网关"
  systemctl restart doushisi-public
  if wait_health http://127.0.0.1:3003/health 30; then
    say "自检（经本机 nginx 走公网路径）"
    for item in "健康检查|200|${PUBLIC}/health" "游戏页 /client/|200|${PUBLIC}/client/" \
                "大厅接口（未登录应 401）|401|${PUBLIC}/api/lobby/tables" \
                "管理后台页面|200|${PUBLIC}/admin/" "后台接口（未登录应 401）|401|${PUBLIC}/api/admin/me"; do
      local name=${item%%|*} rest=${item#*|} code
      code=$(curl_code "${rest#*|}")
      if [ "${code}" = "${rest%%|*}" ]; then printf '  ok  %s\n' "${name}"; else printf '  !!  %s：期望 %s，实际 %s\n' "${name}" "${rest%%|*}" "${code}"; fail=1; fi
    done
  else
    echo "  !!  网关 30 秒内没起来"; fail=1
  fi
  if [ "${fail}" = 1 ]; then
    cp -a "${bk}/game-proxy.cjs" "${file}"
    systemctl restart doushisi-public
    wait_health http://127.0.0.1:3003/health 30 && echo "网关已换回原文件" || echo "网关换回后也没起来，请把上面的全部输出发给 Claude"
    die "网关改动没生效，已换回"
  fi
  say "网关已更新：后台 ${PUBLIC}/admin/"
  echo "原网关文件在 ${bk}/game-proxy.cjs；要换回：cp -a ${bk}/game-proxy.cjs ${file} && systemctl restart doushisi-public"
}

rollback() {
  local with_db=$1 prev=${R}/app.prev-${STAMP} bk=${BK}/${STAMP} now
  now=$(date -u +%Y%m%dT%H%M%SZ)
  [ -d "${bk}" ] || die "找不到 ${bk}"
  if [ ! -d "${prev}" ] && [ "${with_db}" != 1 ]; then die "没有 ${prev}，代码可能已经自动换回过"; fi
  if [ "${with_db}" = 1 ] && [ ! -f "${bk}/database.tgz" ]; then die "没有 ${bk}/database.tgz"; fi
  say "停服"
  systemctl stop doushisi-public doushisi-game
  if [ -d "${prev}" ]; then
    say "代码换回 ${STAMP} 发布前的版本"
    mv "${APP}" "${R}/app.rolledback-${now}"
    mv "${prev}" "${APP}"
  fi
  if [ -f "${bk}/nginx-doushisi" ]; then
    cp -a "${bk}/nginx-doushisi" "${NGINX}"
    nginx -t
    systemctl reload nginx
    echo "nginx 已还原"
  fi
  if [ "${with_db}" = 1 ]; then
    say "数据库换回发布前的备份（现在的库留在 ${bk}/database.replaced-${now}）"
    mv "${DATA}/database" "${bk}/database.replaced-${now}"
    tar -xzf "${bk}/database.tgz" -C "${DATA}"
    chown -R doushisi:doushisi "${DATA}/database"
  fi
  say "启动"
  start_services || die "服务没有按时起来"
  say "回滚完成"
  cat "${APP}/RELEASE" 2>/dev/null || echo "（线上是 10-09 安装的版本）"
}

main() {
  local mode=${1:-}
  shift || true
  case "${mode}" in
    check) check_only ;;
    release) STAMP=$1; shift; trap on_exit EXIT; release "$@" ;;
    apk) STAMP=$1; shift; apk "$@" ;;
    gateway) STAMP=$1; shift; gateway ;;
    rollback) STAMP=$1; shift; rollback "$@" ;;
    *) die "未知模式：${mode}" ;;
  esac
}

main "$@" </dev/null
