#!/usr/bin/env bash
# Creates the project's own Android signing key, once:
#
#   bash tools/android-keygen.sh
#
#   ~/.doushisi-signing/doushisi-release.jks            PKCS12, alias doushisi, RSA 3072, 10000 days
#   ~/.doushisi-signing/doushisi-release.cert-sha256    certificate fingerprint (not secret)
#
# Never overwrites an existing key. The password comes from DOUSHISI_KEYSTORE_PASSWORD or is typed
# twice (hidden); it is handed to keytool through that environment variable only, never written to a
# file, an argument list or a log. keytool comes from the JRE installed by android-tools-install.sh.
set -euo pipefail

SIGNING_HOME="${DOUSHISI_SIGNING_HOME:-$HOME/.doushisi-signing}"
KEYSTORE="$SIGNING_HOME/doushisi-release.jks"
CERT_FILE="$SIGNING_HOME/doushisi-release.cert-sha256"
ALIAS='doushisi'
TOOL_HOME="${DOUSHISI_ANDROID_HOME:-$HOME/.doushisi-android}"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

die() { printf '生成失败：%s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -ne 0 ] || die '不要用 root/sudo 运行。'
case "$SIGNING_HOME/" in
  "$PROJECT_DIR"/*) die "签名目录不能在源码目录里：$SIGNING_HOME" ;;
esac

if [ -e "$KEYSTORE" ]; then
  echo "签名钥匙已存在，不会覆盖：$KEYSTORE"
  [ -f "$CERT_FILE" ] && echo "证书 SHA-256：$(cat "$CERT_FILE")"
  exit 0
fi

JAVA_HOME_DIR="${DOUSHISI_JAVA_HOME:-}"
if [ -z "$JAVA_HOME_DIR" ] && [ -f "$TOOL_HOME/toolchain.env" ]; then
  JAVA_HOME_DIR="$(sed -n "s/^DOUSHISI_JAVA_HOME='\(.*\)'$/\1/p" "$TOOL_HOME/toolchain.env" | head -n 1)"
fi
KEYTOOL="$JAVA_HOME_DIR/bin/keytool"
if [ -z "$JAVA_HOME_DIR" ] || [ ! -x "$KEYTOOL" ]; then
  die "找不到 keytool（需要先装 Java 运行时）。请先运行：
  bash $PROJECT_DIR/tools/android-tools-install.sh"
fi

password="${DOUSHISI_KEYSTORE_PASSWORD:-}"
if [ -z "$password" ]; then
  [ -t 0 ] || die '没有 DOUSHISI_KEYSTORE_PASSWORD，又不在终端里，无法询问密码。'
  read -r -s -p '设置签名密码（至少 6 位，输入不显示）：' password; echo
  read -r -s -p '再输一次：' confirm; echo
  if [ "$password" != "$confirm" ]; then
    unset password confirm
    die '两次输入不一致。'
  fi
  unset confirm
fi
if [ "${#password}" -lt 6 ]; then
  unset password
  die '密码至少 6 位。'
fi

umask 077
mkdir -p "$SIGNING_HOME"
chmod 700 "$SIGNING_HOME"

DOUSHISI_KEYSTORE_PASSWORD="$password" "$KEYTOOL" -genkeypair -noprompt \
  -keystore "$KEYSTORE" -storetype PKCS12 \
  -alias "$ALIAS" -keyalg RSA -keysize 3072 -validity 10000 \
  -dname 'CN=Doushisi' \
  -storepass:env DOUSHISI_KEYSTORE_PASSWORD -keypass:env DOUSHISI_KEYSTORE_PASSWORD >/dev/null
chmod 600 "$KEYSTORE"

listing="$(DOUSHISI_KEYSTORE_PASSWORD="$password" "$KEYTOOL" -list -v -keystore "$KEYSTORE" -storetype PKCS12 \
  -alias "$ALIAS" -storepass:env DOUSHISI_KEYSTORE_PASSWORD)"
unset password
digest="$(printf '%s\n' "$listing" | awk -F': ' '/SHA256:/ {print $2; exit}' | tr -d ':[:space:]' | tr 'A-F' 'a-f')"
unset listing
[ "${#digest}" -eq 64 ] || die "钥匙已生成（${KEYSTORE}），但读不到证书指纹。"
printf '%s\n' "$digest" > "$CERT_FILE"
chmod 600 "$CERT_FILE"

cat <<EOF
签名钥匙已生成：$KEYSTORE
证书 SHA-256：  ${digest}（已存到 ${CERT_FILE}，打包时自动核对）
请马上备份：把这个 .jks 文件和密码分开保存（例如密码放密码管理器，.jks 放加密 U 盘）。
钥匙或密码丢了，已装的 APP 就只能卸载重装。不要把它放进源码目录。
EOF
