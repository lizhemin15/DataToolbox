#!/usr/bin/env python3
"""DataToolbox MCP 快速测试脚本"""
import http.client, json, sys, time

TOKEN_FILE = '/tmp/dt_token.txt'
HOST = 'localhost'
PORT = 8080

def get_token():
    with open(TOKEN_FILE) as f:
        return f.read().strip()

def mcp_call(method, params=None, token=None):
    if not token:
        token = get_token()
    conn = http.client.HTTPConnection(HOST, PORT)
    headers = {
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream'
    }
    body = json.dumps({'jsonrpc':'2.0','id':1,'method':method,'params':params or {}})
    conn.request('POST', '/mcp', body, headers)
    resp = conn.getresponse()
    data = resp.read().decode()
    conn.close()
    return resp.status, json.loads(data) if data else {}

def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'check'
    token = get_token()
    
    if cmd == 'check':
        # 基础检查：initialize + tools/list
        status, data = mcp_call('initialize', {
            'protocolVersion': '2025-03-26',
            'capabilities': {},
            'clientInfo': {'name':'test','version':'1.0'}
        }, token)
        if status != 200:
            print(f'❌ Initialize failed: {status}')
            sys.exit(1)
        print(f'✅ MCP initialize OK (server: {data.get("result",{}).get("serverInfo",{}).get("name","?")})')
        
        status, data = mcp_call('tools/list', {}, token)
        tools = data.get('result',{}).get('tools',[])
        print(f'✅ {len(tools)} tools registered')
        for t in tools:
            print(f'  - {t["name"]}')
    
    elif cmd == 'ask_user':
        # 测试 ask_user（5秒超时）
        interaction = sys.argv[2] if len(sys.argv) > 2 else 'confirm'
        title = sys.argv[3] if len(sys.argv) > 3 else 'Test'
        print(f'Testing ask_user ({interaction})...')
        try:
            status, data = mcp_call('tools/call', {
                'name': 'ask_user',
                'arguments': {
                    'interaction_type': interaction,
                    'title': title,
                    'timeout_seconds': 5
                }
            }, token)
            print(f'Status: {status}, Result: {json.dumps(data, ensure_ascii=False)[:200]}')
        except Exception as e:
            print(f'ask_user timed out (expected if no frontend response): {e}')
    
    elif cmd == 'login':
        # 重新获取 token
        import urllib.request
        req = urllib.request.Request(
            'http://localhost:8080/api/v1/system/auth/login',
            data=json.dumps({'username':'admin','password':'admin1234'}).encode(),
            headers={'Content-Type':'application/json'}
        )
        resp = urllib.request.urlopen(req)
        data = json.loads(resp.read())
        token = data.get('token','')
        with open(TOKEN_FILE,'w') as f:
            f.write(token)
        print(f'✅ Token saved ({len(token)} chars)')
    
    else:
        print(f'Usage: {sys.argv[0]} [check|ask_user|login]')

if __name__ == '__main__':
    main()
