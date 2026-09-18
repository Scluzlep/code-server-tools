#!/bin/bash
set -euo pipefail

# ==============================================================================
# 检测上游 linuxserver/docker-code-server 是否发布新版本
# ==============================================================================

UPSTREAM_REPO="linuxserver/docker-code-server"
DOCKERHUB_REPO="linuxserver/code-server"
REGISTRY_OWNER="${REGISTRY_OWNER:-scluzlep}"
RUNNER_IMAGE_NAME="${RUNNER_IMAGE_NAME:-code-server-withtools}"

echo "Checking upstream latest release for ${UPSTREAM_REPO}..."

# 获取 upstream 最新 Release tag
LATEST_RELEASE=$(curl -fsSL "https://api.github.com/repos/${UPSTREAM_REPO}/releases/latest" 2>/dev/null | jq -r '.tag_name // empty' || true)

if [ -z "${LATEST_RELEASE}" ]; then
    echo "Warning: Failed to fetch GitHub release tag, falling back to Docker Hub manifest check."
    FULL_TAG="latest"
    SHORT_TAG="latest"
else
    FULL_TAG="${LATEST_RELEASE#v}"
    SHORT_TAG=$(echo "${FULL_TAG}" | sed -E 's/-ls[0-9]+$//')
    echo "Found upstream latest GitHub release tag: ${FULL_TAG} (Base semver: ${SHORT_TAG})"
fi

# 获取 Docker Hub 上 linuxserver/code-server:latest 的摘要/更新时间
DOCKERHUB_DIGEST=$(curl -fsSL "https://hub.docker.com/v2/repositories/${DOCKERHUB_REPO}/tags/latest" 2>/dev/null | jq -r '.digest // .images[0].digest // empty' || true)
echo "Docker Hub upstream latest digest: ${DOCKERHUB_DIGEST:-unknown}"

# 输出到 GITHUB_OUTPUT (如果在 Actions 环境下)
if [ -n "${GITHUB_OUTPUT:-}" ]; then
    echo "latest_upstream_tag=${FULL_TAG}" >> "$GITHUB_OUTPUT"
    echo "short_upstream_tag=${SHORT_TAG}" >> "$GITHUB_OUTPUT"
    echo "latest_upstream_digest=${DOCKERHUB_DIGEST}" >> "$GITHUB_OUTPUT"
fi

echo "Upstream check completed."
