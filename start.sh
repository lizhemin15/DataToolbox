#!/bin/bash
cd "$(dirname "$0")"
echo "===================================="
echo "DataToolbox 服务器"
echo "===================================="
echo ""
if [ -z "$1" ]; then
    ./datatoolbox-server
else
    ./datatoolbox-server -port "$1"
fi
