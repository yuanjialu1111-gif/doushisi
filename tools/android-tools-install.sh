#!/usr/bin/env bash
# Installs the Android packaging toolchain used by tools/android-build.mjs.
#
#   bash tools/android-tools-install.sh
#
# Everything goes to ~/.doushisi-android (override with DOUSHISI_ANDROID_HOME):
#   jre/jdk-21.0.13+9-jre/        Eclipse Temurin 21 JRE (macOS, arm64 or x64)
#   apktool/apktool_3.0.3.jar     Apktool
#   sdk/cmdline-tools/latest/     Android command-line tools (sdkmanager)
#   sdk/build-tools/35.0.0/       zipalign + apksigner (installed by sdkmanager)
#   toolchain.env                 paths read by android-build.mjs / android-keygen.sh
#   work/ out/ framework/         build scratch, outputs, apktool framework
# No sudo, no system settings, nothing outside that folder. Safe to re-run: finished steps are
# skipped. Every direct download is pinned and checked against the SHA-256 below before use;
# build-tools come through sdkmanager, which checks Google's repository checksums, and its
# licence prompt is answered by you (the script never accepts licences on your behalf).
set -euo pipefail

ROOT="${DOUSHISI_ANDROID_HOME:-$HOME/.doushisi-android}"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# --- pinned sources ---------------------------------------------------------------------------
# Temurin JRE: sha256 from api.adoptium.net (latest + release_name endpoints agree).
JRE_RELEASE='jdk-21.0.13+9'
JRE_URL_BASE='https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.13%2B9/'
JRE_ARM64_FILE='OpenJDK21U-jre_aarch64_mac_hotspot_21.0.13_9.tar.gz'
JRE_ARM64_SHA256='225bab0a09491ef06835488cd942f5d2befa9a0410a2484f0c8bbcf7506ec09a'
JRE_X64_FILE='OpenJDK21U-jre_x64_mac_hotspot_21.0.13_9.tar.gz'
JRE_X64_SHA256='c909674b1c10c261b9a3fb7e9c0efebd303e33f88a4fe84be7135b5e2d711f89'
# Apktool: sha256 from the GitHub release asset digest (15478013 bytes).
APKTOOL_VERSION='3.0.3'
APKTOOL_URL='https://github.com/iBotPeaches/Apktool/releases/download/v3.0.3/apktool_3.0.3.jar'
APKTOOL_SHA256='dbf930b076c6b9be08d57c449cacefc3bdd6b71ebd59b3066fc0e1f5b14f9423'
# Command-line tools: sha256 from developer.android.com/studio ("Command line tools only").
CMDLINE_URL_BASE='https://dl.google.com/android/repository/'
CMDLINE_ARM64_FILE='commandlinetools-mac_arm64-15859902_latest.zip'
CMDLINE_ARM64_SHA256='835b62a26162b229b441d1f6d4680383815a270809eb33522c0d480fa5002c4e'
CMDLINE_X64_FILE='commandlinetools-mac_x86_64-15859902_latest.zip'
CMDLINE_X64_SHA256='c5a6378ab5cf7e0d5701921405115befff13e9ff7417fb588389338f8bd050f3'
BUILD_TOOLS_VERSION='35.0.0'
# ------------------------------------------------------------------------------------------------

info() { printf '==> %s\n' "$*"; }
warn() { printf '注意：%s\n' "$*" >&2; }
die() { printf '安装失败：%s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -ne 0 ] || die '不要用 root/sudo 运行，这个脚本只往你自己的用户目录里装。'
[ "$(uname -s)" = 'Darwin' ] || die '只支持 macOS。'
for command in curl shasum tar unzip awk; do
  command -v "$command" >/dev/null 2>&1 || die "缺少系统命令 $command"
done
case "$ROOT/" in
  "$PROJECT_DIR"/*) die "安装目录不能在源码目录里：$ROOT" ;;
esac

if [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = '1' ]; then
  ARCH='arm64'
  JRE_FILE="$JRE_ARM64_FILE"; JRE_SHA256="$JRE_ARM64_SHA256"
  CMDLINE_FILE="$CMDLINE_ARM64_FILE"; CMDLINE_SHA256="$CMDLINE_ARM64_SHA256"
elif [ "$(uname -m)" = 'x86_64' ]; then
  ARCH='x86_64'
  JRE_FILE="$JRE_X64_FILE"; JRE_SHA256="$JRE_X64_SHA256"
  CMDLINE_FILE="$CMDLINE_X64_FILE"; CMDLINE_SHA256="$CMDLINE_X64_SHA256"
else
  die "不认识的 CPU 架构：$(uname -m)"
fi

DOWNLOADS="$ROOT/downloads"
JAVA_HOME_DIR="$ROOT/jre/$JRE_RELEASE-jre/Contents/Home"
APKTOOL_JAR="$ROOT/apktool/apktool_$APKTOOL_VERSION.jar"
SDK_ROOT="$ROOT/sdk"
SDKMANAGER="$SDK_ROOT/cmdline-tools/latest/bin/sdkmanager"
BUILD_TOOLS="$SDK_ROOT/build-tools/$BUILD_TOOLS_VERSION"

umask 022
mkdir -p "$ROOT" "$DOWNLOADS" "$ROOT/jre" "$ROOT/apktool" "$SDK_ROOT" "$ROOT/work" "$ROOT/out" "$ROOT/framework" "$ROOT/android-user-home"
chmod 700 "$ROOT"

sha256_of() { shasum -a 256 "$1" | awk '{print $1}'; }

# download <url> <destination> <sha256>: reuses a verified file, never keeps an unverified one.
download() {
  local url="$1" destination="$2" expected="$3" actual
  [ -n "$expected" ] || die "没有 $(basename "$destination") 的 SHA-256，拒绝下载。"
  if [ -f "$destination" ] && [ "$(sha256_of "$destination")" = "$expected" ]; then
    info "已下载并校验：$(basename "$destination")"
    return 0
  fi
  rm -f "$destination" "$destination.part"
  info "下载 $url"
  curl -fL --retry 3 --proto '=https' --proto-redir '=https' --tlsv1.2 -o "$destination.part" "$url"
  actual="$(sha256_of "$destination.part")"
  if [ "$actual" != "$expected" ]; then
    rm -f "$destination.part"
    die "$(basename "$destination") 校验失败：应为 ${expected}，实际 $actual"
  fi
  mv "$destination.part" "$destination"
  info "SHA-256 通过：$(basename "$destination")"
}

java_ok() { [ -x "$JAVA_HOME_DIR/bin/java" ] && "$JAVA_HOME_DIR/bin/java" -version >/dev/null 2>&1; }

# 1. Temurin JRE 21 --------------------------------------------------------------------------
if java_ok; then
  info "JRE 已安装：$JAVA_HOME_DIR"
else
  download "$JRE_URL_BASE$JRE_FILE" "$DOWNLOADS/$JRE_FILE" "$JRE_SHA256"
  extract="$(mktemp -d "$ROOT/jre/.extract.XXXXXX")"
  tar -xzf "$DOWNLOADS/$JRE_FILE" -C "$extract"
  [ -x "$extract/$JRE_RELEASE-jre/Contents/Home/bin/java" ] || { rm -rf "$extract"; die "JRE 压缩包结构和预期不同"; }
  rm -rf "$ROOT/jre/$JRE_RELEASE-jre"
  mv "$extract/$JRE_RELEASE-jre" "$ROOT/jre/$JRE_RELEASE-jre"
  rm -rf "$extract"
  java_ok || die "JRE 解压后无法运行：$JAVA_HOME_DIR/bin/java"
  rm -f "$DOWNLOADS/$JRE_FILE"
  info "JRE 安装完成"
fi

# 2. Apktool ---------------------------------------------------------------------------------
download "$APKTOOL_URL" "$APKTOOL_JAR" "$APKTOOL_SHA256"

# 3. Android command-line tools ----------------------------------------------------------------
if [ -x "$SDKMANAGER" ]; then
  info "command-line tools 已安装"
else
  download "$CMDLINE_URL_BASE$CMDLINE_FILE" "$DOWNLOADS/$CMDLINE_FILE" "$CMDLINE_SHA256"
  extract="$(mktemp -d "$SDK_ROOT/.extract.XXXXXX")"
  unzip -q "$DOWNLOADS/$CMDLINE_FILE" -d "$extract"
  [ -x "$extract/cmdline-tools/bin/sdkmanager" ] || { rm -rf "$extract"; die "command-line tools 压缩包结构和预期不同"; }
  mkdir -p "$SDK_ROOT/cmdline-tools"
  rm -rf "$SDK_ROOT/cmdline-tools/latest"
  mv "$extract/cmdline-tools" "$SDK_ROOT/cmdline-tools/latest"
  rm -rf "$extract"
  rm -f "$DOWNLOADS/$CMDLINE_FILE"
  info "command-line tools 安装完成"
fi

# 4. build-tools (zipalign, apksigner) through sdkmanager -------------------------------------
if [ -f "$BUILD_TOOLS/lib/apksigner.jar" ]; then
  info "build-tools $BUILD_TOOLS_VERSION 已安装"
else
  [ -t 0 ] || die "安装 build-tools 需要你在终端里亲自同意 Android SDK 许可，请在终端里直接运行本脚本。"
  info "安装 build-tools ${BUILD_TOOLS_VERSION}（sdkmanager 会显示 Google 的许可条款，阅读后输入 y 同意）"
  JAVA_HOME="$JAVA_HOME_DIR" ANDROID_USER_HOME="$ROOT/android-user-home" \
    "$SDKMANAGER" --sdk_root="$SDK_ROOT" "build-tools;$BUILD_TOOLS_VERSION"
  [ -f "$BUILD_TOOLS/lib/apksigner.jar" ] || die "build-tools 没装上（许可未同意或下载失败），可再次运行本脚本。"
fi

# 5. toolchain.env -----------------------------------------------------------------------------
cat > "$ROOT/toolchain.env.tmp" <<EOF
# Written by tools/android-tools-install.sh; read by tools/android-build.mjs and tools/android-keygen.sh
DOUSHISI_JAVA_HOME='$JAVA_HOME_DIR'
DOUSHISI_APKTOOL_JAR='$APKTOOL_JAR'
DOUSHISI_BUILD_TOOLS='$BUILD_TOOLS'
EOF
mv "$ROOT/toolchain.env.tmp" "$ROOT/toolchain.env"

# 6. Self-check ----------------------------------------------------------------------------------
JAVA_VERSION="$("$JAVA_HOME_DIR/bin/java" -version 2>&1 | head -n 1)"
APKTOOL_REPORTED="$("$JAVA_HOME_DIR/bin/java" -jar "$APKTOOL_JAR" --version 2>/dev/null | head -n 1 || true)"
APKSIGNER_REPORTED="$("$JAVA_HOME_DIR/bin/java" -jar "$BUILD_TOOLS/lib/apksigner.jar" --version 2>/dev/null | head -n 1 || true)"
[ -n "$APKSIGNER_REPORTED" ] || die "apksigner 无法运行"
ZIPALIGN_STATE='缺失（打包时改由 apksigner 对齐）'
if [ -f "$BUILD_TOOLS/zipalign" ]; then
  set +e
  "$BUILD_TOOLS/zipalign" >/dev/null 2>&1
  zipalign_status=$?
  set -e
  if [ "$zipalign_status" -eq 126 ] || [ "$zipalign_status" -eq 127 ]; then
    ZIPALIGN_STATE="无法运行（$(file -b "$BUILD_TOOLS/zipalign" | head -c 80)）；打包时改由 apksigner 对齐"
  else
    ZIPALIGN_STATE="可用（$(file -b "$BUILD_TOOLS/zipalign" | awk '{print $NF}')）"
  fi
fi

cat <<EOF

安装完成（${ARCH}）：$ROOT
  Java       $JAVA_VERSION
  apktool    ${APKTOOL_REPORTED:-$APKTOOL_VERSION}
  apksigner  $APKSIGNER_REPORTED
  zipalign   $ZIPALIGN_STATE
  配置文件   $ROOT/toolchain.env
下一步：生成签名钥匙（只需一次）
  bash $PROJECT_DIR/tools/android-keygen.sh
EOF
