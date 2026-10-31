#!/usr/bin/env bash
# 把本机当前提交发布到测试服 108，由用户自己在终端运行（DEC-20261030-测试服发布）。
#   bash tools/release-test-server.sh --check                         只读预检：本机和服务器，不改任何东西
#   bash tools/release-test-server.sh                                 发布后端：构建 → 上传 → 旁边预装 → 停服切换 → 自检，失败自动换回旧版
#   bash tools/release-test-server.sh --apk <APK 文件>                 只换下载页的安装包
#   bash tools/release-test-server.sh --rollback <批次号> [--with-db]  回到某次发布前；--with-db 连数据库一起，发布后的新数据会丢
# 服务器上的步骤在 tools/release-test-server-remote.sh。Mac 自带 bash 3.2：变量后紧跟中文一律写成 ${VAR}。
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
HOST=108.186.180.130
KEY=${HOME}/.ssh/us_west_108_ed25519
REMOTE_SCRIPT=${ROOT}/tools/release-test-server-remote.sh
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
SSH_OPTS="-o ConnectTimeout=15 -o BatchMode=yes -o ServerAliveInterval=30"

say() { printf '\n== %s\n' "$*"; }
die() { printf '\n!! %s\n' "$*" >&2; exit 1; }
remote() { ssh -i "${KEY}" ${SSH_OPTS} "root@${HOST}" "bash -s -- $*" < "${REMOTE_SCRIPT}"; }
upload() { scp -i "${KEY}" ${SSH_OPTS} "$1" "root@${HOST}:$2"; }
# 构建会刷新 verification/build-manifest.json（进 git 的文件），其余文件都不该变。
dirty_besides_manifest() { git -C "${ROOT}" status --porcelain | grep -v ' verification/build-manifest.json$' || true; }

MODE=release
APK=
ROLLBACK=
WITH_DB=0
while [ $# -gt 0 ]; do
  case "$1" in
    --check) MODE=check ;;
    --apk) MODE=apk; APK=${2:-}; [ -n "${APK}" ] || die "--apk 后面要跟 APK 文件路径"; shift ;;
    --rollback) MODE=rollback; ROLLBACK=${2:-}; [ -n "${ROLLBACK}" ] || die "--rollback 后面要跟批次号"; shift ;;
    --with-db) WITH_DB=1 ;;
    -h|--help) sed -n '2,7p' "$0"; exit 0 ;;
    *) die "不认识的参数：$1" ;;
  esac
  shift
done

[ -f "${KEY}" ] || die "找不到 SSH 私钥 ${KEY}"
for tool in git node pnpm ssh scp shasum tar curl; do
  command -v "${tool}" >/dev/null || die "本机缺少 ${tool}"
done

case "${MODE}" in
  check)
    say "本机"
    echo "提交 $(git -C "${ROOT}" log --oneline -1)"
    if [ -n "$(git -C "${ROOT}" status --porcelain)" ]; then echo "!! 工作区有没提交的改动，正式发布前要先提交"; else echo "工作区干净"; fi
    echo "node $(node -v)，pnpm $(pnpm -v)"
    remote check
    ;;

  apk)
    [ -f "${APK}" ] || die "找不到 ${APK}"
    unzip -l "${APK}" AndroidManifest.xml >/dev/null 2>&1 || die "${APK} 不像是 APK"
    SHA=$(shasum -a 256 "${APK}" | cut -d' ' -f1)
    say "上传安装包（$(du -h "${APK}" | cut -f1)）"
    upload "${APK}" /var/lib/doushisi/downloads/doushisi.apk.upload
    remote apk "${STAMP}" "${SHA}"
    ;;

  rollback)
    case "${ROLLBACK}" in *[!0-9TZ]*) die "批次号形如 20261030T120000Z" ;; esac
    if [ "${WITH_DB}" = 1 ]; then
      echo "会把数据库换回 ${ROLLBACK} 发布前的备份：之后注册的账号、豆子流水、牌局都会丢。"
      printf '确认请输入 RESTORE：'
      answer=
      read -r answer || true
      [ "${answer}" = RESTORE ] || die "已取消"
    fi
    remote rollback "${ROLLBACK}" "${WITH_DB}"
    ;;

  release)
    cd "${ROOT}"
    [ -z "$(git status --porcelain)" ] || die "工作区有没提交的改动，先提交再发布"
    COMMIT=$(git rev-parse --short HEAD)
    WORK=$(mktemp -d "${TMPDIR:-/tmp}/doushisi-release.XXXXXX")
    trap 'rm -rf "${WORK}"; git -C "${ROOT}" checkout -- verification/build-manifest.json 2>/dev/null || true' EXIT

    say "发布 $(git log --oneline -1)（批次 ${STAMP}）"
    say "构建"
    pnpm build
    [ -z "$(dirty_besides_manifest)" ] || die "构建改动了源码文件：$(dirty_besides_manifest)"

    say "核对热更新包和 standalone.js 一致"
    node tools/android-native-adapter.mjs
    [ -z "$(dirty_besides_manifest)" ] || die "client/public/native/ 和 standalone.js 不一致：先提交重新生成的文件再发布"
    NATIVE_SHA=$(node -p "require(process.argv[1]).sha256" "${ROOT}/client/public/native/manifest.json")

    say "打包"
    PATHS="apps/server/dist apps/server/migrations apps/server/package.json apps/admin/dist client/public docs/rules package.json pnpm-lock.yaml verification/build-manifest.json"
    for dir in packages/*/; do
      PATHS="${PATHS} ${dir}dist ${dir}package.json"
    done
    for path in ${PATHS}; do
      [ -e "${path}" ] || die "缺少 ${path}，构建没有产出？"
    done
    TGZ=${WORK}/doushisi-app-${STAMP}.tgz
    COPYFILE_DISABLE=1 tar --no-xattrs --no-mac-metadata --exclude '.DS_Store' -czf "${TGZ}" ${PATHS}
    SHA=$(shasum -a 256 "${TGZ}" | cut -d' ' -f1)
    echo "$(du -h "${TGZ}" | cut -f1)，sha256 ${SHA}"

    say "上传到 ${HOST}"
    ssh -i "${KEY}" ${SSH_OPTS} "root@${HOST}" "install -d -m 700 /opt/doushisi/releases"
    upload "${TGZ}" /opt/doushisi/releases/

    say "服务器上预装、切换、自检"
    remote release "${STAMP}" "${SHA}" "${COMMIT}" "${NATIVE_SHA}"

    say "从本机经公网再看一眼"
    if curl -fsS --max-time 15 "https://${HOST}/health" | grep -q '"status":"ok"'; then
      echo "  ok  https://${HOST}/health"
    else
      echo "  ??  本机访问 https://${HOST}/health 不通（服务器上的自检已过，可能是本机网络或证书）"
    fi
    echo
    echo "批次号 ${STAMP}。要回到这次发布前：bash ${ROOT}/tools/release-test-server.sh --rollback ${STAMP}"
    ;;
esac
