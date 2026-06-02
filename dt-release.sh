#!/bin/bash
# DataToolbox 一键发布部署脚本
# 用法: ./dt-release.sh [commit_message] [tag_version]
# 示例: ./dt-release.sh "fix: xxx" v2026.6.5
# 如果不传 tag_version，只提交推送不创建 tag

set -e
cd /tmp/datatoolbox-src

MSG="${1:-auto commit $(date +%H%M%S)}"
TAG="$2"

# 1. 提交
git add -A
git diff --cached --quiet && echo "Nothing to commit" && exit 0
git commit -m "$MSG"
git push origin main

# 2. 如果指定了 tag，触发 CI release
if [ -n "$TAG" ]; then
    # 删除旧 tag（如果存在）
    git tag -d "$TAG" 2>/dev/null || true
    git push origin ":refs/tags/$TAG" 2>/dev/null || true
    gh release delete "$TAG" --yes 2>/dev/null || true
    
    # 创建新 tag
    git tag "$TAG"
    git push origin "$TAG"
    
    # 等 CI
    echo "⏳ Waiting for CI..."
    sleep 8
    RUN_ID=$(gh run list --limit 1 --json databaseId,name --jq '.[] | select(.name=="Build and Release") | .databaseId')
    if [ -n "$RUN_ID" ]; then
        gh run watch "$RUN_ID" --exit-status 2>&1 | tail -1
        RESULT=$(gh run view "$RUN_ID" --json conclusion --jq '.conclusion')
        if [ "$RESULT" != "success" ]; then
            echo "❌ CI failed: $RESULT"
            exit 1
        fi
    fi
    
    # 3. 下载部署
    echo "📦 Downloading release..."
    cd /tmp && rm -rf datatoolbox-release && mkdir datatoolbox-release && cd datatoolbox-release
    gh release download "$TAG" --repo lizhemin15/DataToolbox
    tar -xzf datatoolbox-linux-amd64.tar.gz
    
    # 4. 部署
    echo "🚀 Deploying..."
    systemctl stop datatoolbox
    cp /tmp/datatoolbox-release/datatoolbox-server /opt/datatoolbox/datatoolbox-server
    cp /tmp/datatoolbox-release/js/*.js /opt/datatoolbox/js/
    cp /tmp/datatoolbox-release/css/*.css /opt/datatoolbox/css/
    cp /tmp/datatoolbox-release/templates/*.json /opt/datatoolbox/templates/
    cp /tmp/datatoolbox-release/index.html /opt/datatoolbox/index.html
    systemctl start datatoolbox
    sleep 2
    
    # 5. 验证
    STATUS=$(systemctl is-active datatoolbox)
    if [ "$STATUS" = "active" ]; then
        echo "✅ Deployed $TAG successfully"
    else
        echo "❌ Service failed to start"
        journalctl -u datatoolbox --since "10 sec ago" --no-pager | tail -10
        exit 1
    fi
else
    echo "✅ Pushed to main (no tag, no CI release)"
fi
