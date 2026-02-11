// ===== 关卡数据 =====
const PHASES = [
    { name: '文件与目录基础', icon: '📂' },
    { name: '网络诊断', icon: '🌐' },
    { name: '服务器运维', icon: '🖥️' },
    { name: 'Docker管理', icon: '🐳' },
    { name: '数据库导入导出', icon: '🗄️' },
    { name: 'Oracle数据库', icon: '🏛️' },
    { name: '达梦数据库', icon: '🐲' }
];

const LEVELS = [
    // ===== 第一阶段：文件与目录基础 =====
    {
        id: 1, phase: 1,
        title: '查看当前目录',
        description: '学习如何查看当前所在的工作目录',
        tutorial: `
            <p>在命令行中，你随时可以查看自己当前在哪个目录下工作。</p>
            <p><span class="os-label linux">Linux</span></p>
            <div class="syntax-block linux-block">pwd</div>
            <p><code>pwd</code>（Print Working Directory）会打印当前工作目录的完整路径。</p>
            <p><span class="os-label win">Windows</span></p>
            <div class="syntax-block win-block">cd</div>
            <p>在 Windows 的 CMD 中，不带参数的 <code>cd</code> 命令会显示当前目录。</p>
        `,
        win: {
            task: '请输入查看当前工作目录的命令。',
            hint: '在 Windows CMD 中，直接输入 cd（不带参数）即可显示当前目录。',
            answer: 'cd',
            validate(cmd) {
                return [
                    { pass: /^cd\s*$/i.test(cmd.trim()), msg: '使用 cd 命令（不带参数）查看当前目录' }
                ];
            }
        },
        linux: {
            task: '请输入查看当前工作目录的命令。',
            hint: '使用 pwd 命令即可打印当前工作目录。',
            answer: 'pwd',
            validate(cmd) {
                return [
                    { pass: /^pwd\s*$/i.test(cmd.trim()), msg: '使用 pwd 命令打印当前工作目录' }
                ];
            }
        },
        context: `
            <div class="context-label">常见输出示例：</div>
            <div class="cmd-block">Linux: /home/user/projects
Windows: C:\\Users\\user\\projects</div>
        `
    },
    {
        id: 2, phase: 1,
        title: '列出文件和目录',
        description: '学习如何查看目录下的文件列表',
        tutorial: `
            <p>列出当前目录下的文件和子目录是最常用的操作之一。</p>
            <p><span class="os-label linux">Linux</span></p>
            <div class="syntax-block linux-block">ls          # 简单列出
ls -l       # 详细列表（权限、大小、日期）
ls -la      # 包含隐藏文件的详细列表</div>
            <p><span class="os-label win">Windows</span></p>
            <div class="syntax-block win-block">dir          # 列出文件和目录
dir /a       # 包含隐藏文件</div>
        `,
        win: {
            task: '请输入列出当前目录下所有文件和目录的命令。',
            hint: '使用 dir 命令列出目录内容。',
            answer: 'dir',
            validate(cmd) {
                return [
                    { pass: /^dir(\s|$)/i.test(cmd.trim()), msg: '使用 dir 命令列出目录内容' }
                ];
            }
        },
        linux: {
            task: '请输入以详细列表形式列出所有文件（包含隐藏文件）的命令。',
            hint: '使用 ls -la 可以显示所有文件的详细信息，包含隐藏文件。',
            answer: 'ls -la',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^ls\s/.test(c), msg: '使用 ls 命令' },
                    { pass: /\-[a-z]*l[a-z]*/i.test(c), msg: '包含 -l 参数显示详细列表' },
                    { pass: /\-[a-z]*a[a-z]*/i.test(c), msg: '包含 -a 参数显示隐藏文件' }
                ];
            }
        },
        context: `
            <div class="context-label">ls -la 输出示例：</div>
            <div class="cmd-block">total 32
drwxr-xr-x  5 user group 4096 Jan 10 10:00 .
drwxr-xr-x  3 user group 4096 Jan  9 08:00 ..
-rw-r--r--  1 user group  220 Jan  9 08:00 .bashrc
-rw-r--r--  1 user group 1024 Jan 10 10:00 readme.md
drwxr-xr-x  2 user group 4096 Jan 10 09:00 src</div>
        `
    },
    {
        id: 3, phase: 1,
        title: '切换目录',
        description: '学习如何在不同目录间跳转',
        tutorial: `
            <p><code>cd</code>（Change Directory）在两个系统中都用于切换目录。</p>
            <div class="syntax-block">cd 目录路径       # 进入指定目录
cd ..            # 返回上一级目录
cd ~             # (Linux) 回到用户主目录
cd /             # 进入根目录
cd \\             # (Windows) 进入根目录</div>
            <p>Linux 中 <code>~</code> 代表用户主目录（如 /home/user），Windows 中可用 <code>cd %USERPROFILE%</code>。</p>
        `,
        win: {
            task: '请输入切换到 <code>C:\\Users\\admin\\Desktop</code> 目录的命令。',
            hint: '使用 cd C:\\Users\\admin\\Desktop',
            answer: 'cd C:\\Users\\admin\\Desktop',
            validate(cmd) {
                return [
                    { pass: /^cd\s/i.test(cmd.trim()), msg: '使用 cd 命令切换目录' },
                    { pass: /C:\\Users\\admin\\Desktop/i.test(cmd), msg: '目标路径为 C:\\Users\\admin\\Desktop' }
                ];
            }
        },
        linux: {
            task: '请输入切换到 <code>/var/log</code> 目录的命令。',
            hint: '使用 cd /var/log',
            answer: 'cd /var/log',
            validate(cmd) {
                return [
                    { pass: /^cd\s/i.test(cmd.trim()), msg: '使用 cd 命令切换目录' },
                    { pass: /\/var\/log/.test(cmd), msg: '目标路径为 /var/log' }
                ];
            }
        },
        context: `
            <div class="context-label">路径类型：</div>
            <div class="scenario-block">绝对路径：从根目录开始的完整路径
  Linux: /home/user/docs
  Windows: C:\\Users\\user\\docs

相对路径：相对于当前目录
  ./subdir    当前目录下的 subdir
  ../other    上一级目录下的 other</div>
        `
    },
    {
        id: 4, phase: 1,
        title: '创建与删除目录',
        description: '学习创建和删除目录的命令',
        tutorial: `
            <p>创建目录：</p>
            <div class="syntax-block">mkdir 目录名             # 创建单个目录
mkdir -p a/b/c          # (Linux) 递归创建多级目录
mkdir a\\b\\c             # (Windows) 自动创建多级目录</div>
            <p>删除目录：</p>
            <div class="syntax-block">rmdir 目录名             # 删除空目录
rm -rf 目录名            # (Linux) 强制递归删除目录及内容
rmdir /s /q 目录名       # (Windows) 递归删除目录</div>
        `,
        win: {
            task: '请输入递归删除 <code>temp</code> 目录及其所有内容的命令（静默模式）。',
            hint: '使用 rmdir /s /q temp',
            answer: 'rmdir /s /q temp',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^rmdir\s/i.test(c), msg: '使用 rmdir 命令' },
                    { pass: /\/s/i.test(c), msg: '包含 /s 参数进行递归删除' },
                    { pass: /\/q/i.test(c), msg: '包含 /q 参数静默执行' },
                    { pass: /temp/i.test(c), msg: '目标目录为 temp' }
                ];
            }
        },
        linux: {
            task: '请输入递归创建 <code>projects/app/src</code> 多级目录的命令。',
            hint: '使用 mkdir -p projects/app/src',
            answer: 'mkdir -p projects/app/src',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^mkdir\s/i.test(c), msg: '使用 mkdir 命令' },
                    { pass: /\-p/.test(c), msg: '包含 -p 参数递归创建' },
                    { pass: /projects\/app\/src/.test(c), msg: '目标路径为 projects/app/src' }
                ];
            }
        },
        context: `
            <div class="context-label">注意事项：</div>
            <div class="scenario-block">rm -rf 是非常危险的命令！
它会强制删除目标目录及所有子文件，且不可恢复。
使用前请务必确认路径正确，切勿在根目录 / 下执行。</div>
        `
    },
    {
        id: 5, phase: 1,
        title: '文件复制与移动',
        description: '学习复制、移动、删除文件的操作',
        tutorial: `
            <p><span class="os-label linux">Linux</span></p>
            <div class="syntax-block linux-block">cp 源文件 目标文件        # 复制文件
cp -r 源目录 目标目录     # 递归复制目录
mv 源 目标               # 移动/重命名
rm 文件名                # 删除文件</div>
            <p><span class="os-label win">Windows</span></p>
            <div class="syntax-block win-block">copy 源文件 目标文件      # 复制文件
xcopy 源 目标 /E /I      # 递归复制目录
move 源 目标             # 移动/重命名
del 文件名               # 删除文件</div>
        `,
        win: {
            task: '请输入将 <code>report.txt</code> 复制到 <code>backup\\report.txt</code> 的命令。',
            hint: '使用 copy report.txt backup\\report.txt',
            answer: 'copy report.txt backup\\report.txt',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^copy\s/i.test(c), msg: '使用 copy 命令' },
                    { pass: /report\.txt/i.test(c), msg: '源文件为 report.txt' },
                    { pass: /backup\\report\.txt/i.test(c), msg: '目标为 backup\\report.txt' }
                ];
            }
        },
        linux: {
            task: '请输入将 <code>config</code> 目录递归复制到 <code>/backup/config</code> 的命令。',
            hint: '使用 cp -r config /backup/config',
            answer: 'cp -r config /backup/config',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^cp\s/i.test(c), msg: '使用 cp 命令' },
                    { pass: /\-r/.test(c), msg: '包含 -r 参数进行递归复制' },
                    { pass: /config/.test(c), msg: '源目录为 config' },
                    { pass: /\/backup\/config/.test(c), msg: '目标路径为 /backup/config' }
                ];
            }
        },
        context: `
            <div class="context-label">mv / move 命令的双重功能：</div>
            <div class="scenario-block">1. 移动文件/目录到新位置
   mv file.txt /new/path/
2. 重命名文件/目录
   mv oldname.txt newname.txt</div>
        `
    },
    {
        id: 6, phase: 1,
        title: '查看文件内容',
        description: '学习查看和搜索文件内容的命令',
        tutorial: `
            <p><span class="os-label linux">Linux</span></p>
            <div class="syntax-block linux-block">cat 文件名          # 查看整个文件
head -n 20 文件名   # 查看前20行
tail -n 20 文件名   # 查看后20行
tail -f 文件名      # 实时跟踪文件末尾（常用于看日志）
grep "关键词" 文件名 # 搜索文件内容</div>
            <p><span class="os-label win">Windows</span></p>
            <div class="syntax-block win-block">type 文件名          # 查看整个文件
more 文件名          # 分页查看
findstr "关键词" 文件名 # 搜索文件内容</div>
        `,
        win: {
            task: '请输入在 <code>server.log</code> 中搜索包含 <code>ERROR</code> 关键词的行的命令。',
            hint: '使用 findstr "ERROR" server.log',
            answer: 'findstr "ERROR" server.log',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^findstr\s/i.test(c), msg: '使用 findstr 命令' },
                    { pass: /ERROR/i.test(c), msg: '搜索关键词包含 ERROR' },
                    { pass: /server\.log/i.test(c), msg: '在 server.log 中搜索' }
                ];
            }
        },
        linux: {
            task: '请输入实时跟踪 <code>/var/log/syslog</code> 文件末尾新内容的命令。',
            hint: '使用 tail -f /var/log/syslog',
            answer: 'tail -f /var/log/syslog',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^tail\s/i.test(c), msg: '使用 tail 命令' },
                    { pass: /\-f/.test(c), msg: '包含 -f 参数进行实时跟踪' },
                    { pass: /\/var\/log\/syslog/.test(c), msg: '目标文件为 /var/log/syslog' }
                ];
            }
        },
        context: `
            <div class="context-label">tail -f 的实用场景：</div>
            <div class="scenario-block">运维中经常需要实时监控日志输出：
  tail -f /var/log/nginx/access.log
  tail -f /var/log/mysql/error.log

按 Ctrl+C 退出实时跟踪。</div>
        `
    },
    {
        id: 7, phase: 1,
        title: '管道与重定向',
        description: '学习管道和输出重定向操作',
        tutorial: `
            <p>管道 <code>|</code> 可以将一个命令的输出传递给下一个命令作为输入：</p>
            <div class="syntax-block">命令1 | 命令2     # 将命令1的输出传给命令2</div>
            <p>重定向可以将命令输出写入文件：</p>
            <div class="syntax-block">&gt; 文件名    # 覆盖写入（文件不存在则创建）
&gt;&gt; 文件名   # 追加写入</div>
            <p>组合示例：</p>
            <div class="syntax-block">ps aux | grep nginx          # 查找nginx进程
ls -la | grep ".log"        # 过滤.log文件
echo "hello" &gt;&gt; output.txt  # 追加文本到文件</div>
        `,
        win: {
            task: '请输入将 <code>dir</code> 的输出结果中包含 <code>.txt</code> 的行过滤出来的命令。',
            hint: '使用 dir | findstr ".txt"',
            answer: 'dir | findstr ".txt"',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^dir\s*\|/i.test(c), msg: '使用 dir 命令并通过管道传递' },
                    { pass: /\|\s*findstr/i.test(c), msg: '管道连接到 findstr 命令' },
                    { pass: /\.txt/i.test(c), msg: '过滤关键词包含 .txt' }
                ];
            }
        },
        linux: {
            task: '请输入查找所有包含 <code>nginx</code> 的进程，并将结果保存到 <code>nginx_ps.txt</code> 文件中的命令。',
            hint: '使用 ps aux | grep nginx > nginx_ps.txt',
            answer: 'ps aux | grep nginx > nginx_ps.txt',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^ps\s+aux/i.test(c), msg: '使用 ps aux 列出所有进程' },
                    { pass: /\|\s*grep/i.test(c), msg: '通过管道连接 grep 过滤' },
                    { pass: /nginx/i.test(c), msg: '过滤关键词为 nginx' },
                    { pass: />\s*nginx_ps\.txt/i.test(c), msg: '输出重定向到 nginx_ps.txt' }
                ];
            }
        },
        context: `
            <div class="context-label">管道链示例：</div>
            <div class="cmd-block">cat access.log | grep "404" | wc -l
# 统计日志中404错误的行数

cat /etc/passwd | cut -d: -f1 | sort
# 列出所有用户名并排序</div>
        `
    },
    {
        id: 8, phase: 1,
        title: '文件权限管理',
        description: '学习修改文件权限和所有者',
        tutorial: `
            <p><span class="os-label linux">Linux</span></p>
            <p>Linux 文件权限分为：<code>r</code>(读) <code>w</code>(写) <code>x</code>(执行)，分别对应所有者(u)、组(g)、其他人(o)。</p>
            <div class="syntax-block linux-block">chmod 755 文件名       # 数字模式设权限
chmod +x 脚本.sh      # 添加执行权限
chown user:group 文件  # 修改所有者</div>
            <p>755 = rwxr-xr-x（所有者全部权限，其他人读+执行）</p>
            <p><span class="os-label win">Windows</span></p>
            <div class="syntax-block win-block">icacls 文件名 /grant 用户:权限
icacls file.txt /grant Everyone:F   # 给所有人完全控制权限</div>
        `,
        win: {
            task: '请输入给 <code>deploy.bat</code> 文件授予 <code>Admin</code> 用户完全控制权限（<code>F</code>）的命令。',
            hint: '使用 icacls deploy.bat /grant Admin:F',
            answer: 'icacls deploy.bat /grant Admin:F',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^icacls\s/i.test(c), msg: '使用 icacls 命令' },
                    { pass: /deploy\.bat/i.test(c), msg: '目标文件为 deploy.bat' },
                    { pass: /\/grant/i.test(c), msg: '使用 /grant 参数授予权限' },
                    { pass: /Admin:F/i.test(c), msg: '授予 Admin 用户完全控制权限(F)' }
                ];
            }
        },
        linux: {
            task: '请输入将 <code>deploy.sh</code> 的权限设为 <code>755</code>（所有者全部权限，其他人读+执行）的命令。',
            hint: '使用 chmod 755 deploy.sh',
            answer: 'chmod 755 deploy.sh',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^chmod\s/i.test(c), msg: '使用 chmod 命令' },
                    { pass: /755/.test(c), msg: '权限值为 755' },
                    { pass: /deploy\.sh/.test(c), msg: '目标文件为 deploy.sh' }
                ];
            }
        },
        context: `
            <div class="context-label">Linux权限数字对照：</div>
            <div class="scenario-block">r=4  w=2  x=1
常见权限组合：
  755 = rwxr-xr-x  目录和可执行文件
  644 = rw-r--r--  普通文件
  600 = rw-------  敏感配置文件
  777 = rwxrwxrwx  所有人全部权限（慎用！）</div>
        `
    },

    // ===== 第二阶段：网络诊断 =====
    {
        id: 9, phase: 2,
        title: '测试网络连通性',
        description: '学习使用 ping 测试网络连接',
        tutorial: `
            <p><code>ping</code> 是最基础的网络诊断工具，用于测试与目标主机的网络连通性。</p>
            <div class="syntax-block">ping 目标地址               # 发送ICMP数据包测试连通
ping -c 4 目标地址          # (Linux) 发送4次后停止
ping -n 4 目标地址          # (Windows) 发送4次后停止
ping -t 目标地址            # (Windows) 持续ping</div>
            <p>Linux 的 ping 默认会持续发送直到 Ctrl+C 停止，Windows 默认发4次。</p>
        `,
        win: {
            task: '请输入持续 ping <code>192.168.1.1</code> 的命令（不限次数）。',
            hint: '使用 ping -t 192.168.1.1',
            answer: 'ping -t 192.168.1.1',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^ping\s/i.test(c), msg: '使用 ping 命令' },
                    { pass: /\-t/i.test(c), msg: '使用 -t 参数持续 ping' },
                    { pass: /192\.168\.1\.1/.test(c), msg: '目标地址为 192.168.1.1' }
                ];
            }
        },
        linux: {
            task: '请输入向 <code>8.8.8.8</code> 发送 <code>4</code> 次 ping 请求的命令。',
            hint: '使用 ping -c 4 8.8.8.8',
            answer: 'ping -c 4 8.8.8.8',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^ping\s/i.test(c), msg: '使用 ping 命令' },
                    { pass: /\-c\s*4/.test(c), msg: '使用 -c 4 限制发送4次' },
                    { pass: /8\.8\.8\.8/.test(c), msg: '目标地址为 8.8.8.8' }
                ];
            }
        },
        context: `
            <div class="context-label">ping 输出分析：</div>
            <div class="cmd-block">PING 8.8.8.8 (8.8.8.8) 56(84) bytes of data.
64 bytes from 8.8.8.8: icmp_seq=1 ttl=117 time=12.3 ms
64 bytes from 8.8.8.8: icmp_seq=2 ttl=117 time=11.8 ms

time=12.3 ms → 延迟12.3毫秒
ttl=117     → 数据包生存时间
丢包率0%     → 网络连通正常</div>
        `
    },
    {
        id: 10, phase: 2,
        title: '查看网络配置',
        description: '学习查看本机IP地址和网络接口信息',
        tutorial: `
            <p><span class="os-label linux">Linux</span></p>
            <div class="syntax-block linux-block">ip addr              # 查看所有网络接口信息（推荐）
ip addr show eth0    # 查看指定接口
ifconfig             # 旧版命令，部分系统仍可用</div>
            <p><span class="os-label win">Windows</span></p>
            <div class="syntax-block win-block">ipconfig             # 查看基本网络配置
ipconfig /all        # 查看详细网络配置（含MAC地址、DNS等）</div>
        `,
        win: {
            task: '请输入查看详细网络配置信息（含MAC地址和DNS）的命令。',
            hint: '使用 ipconfig /all',
            answer: 'ipconfig /all',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^ipconfig/i.test(c), msg: '使用 ipconfig 命令' },
                    { pass: /\/all/i.test(c), msg: '使用 /all 参数查看完整信息' }
                ];
            }
        },
        linux: {
            task: '请输入查看所有网络接口信息的命令。',
            hint: '使用 ip addr',
            answer: 'ip addr',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^ip\s+addr\s*$/i.test(c) || /^ip\s+a\s*$/i.test(c) || /^ifconfig\s*$/i.test(c), msg: '使用 ip addr 或 ifconfig 查看网络接口' }
                ];
            }
        },
        context: `
            <div class="context-label">常见网络接口：</div>
            <div class="scenario-block">lo        → 回环接口 (127.0.0.1)
eth0      → 第一个以太网接口
ens33     → 新命名规则的网络接口
wlan0     → 无线网络接口
docker0   → Docker虚拟网桥</div>
        `
    },
    {
        id: 11, phase: 2,
        title: '查看网络连接与端口',
        description: '学习查看本机网络连接和端口监听状态',
        tutorial: `
            <p><span class="os-label linux">Linux</span></p>
            <div class="syntax-block linux-block">ss -tlnp             # 查看所有TCP监听端口
ss -tunlp            # 查看TCP和UDP监听端口
netstat -tlnp        # 旧版命令（需安装net-tools）</div>
            <p><span class="os-label win">Windows</span></p>
            <div class="syntax-block win-block">netstat -ano         # 查看所有连接和端口（含PID）
netstat -an | findstr :80   # 查看80端口</div>
            <p>参数说明：<code>-t</code> TCP、<code>-u</code> UDP、<code>-l</code> 监听、<code>-n</code> 数字形式、<code>-p</code> 显示进程</p>
        `,
        win: {
            task: '请输入查看所有网络连接和端口占用情况（含进程PID）的命令。',
            hint: '使用 netstat -ano',
            answer: 'netstat -ano',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^netstat\s/i.test(c), msg: '使用 netstat 命令' },
                    { pass: /\-[a-z]*a[a-z]*/i.test(c), msg: '包含 -a 显示所有连接' },
                    { pass: /\-[a-z]*n[a-z]*/i.test(c), msg: '包含 -n 以数字形式显示' },
                    { pass: /\-[a-z]*o[a-z]*/i.test(c), msg: '包含 -o 显示进程PID' }
                ];
            }
        },
        linux: {
            task: '请输入查看所有 TCP 监听端口及对应进程的命令。',
            hint: '使用 ss -tlnp',
            answer: 'ss -tlnp',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^ss\s/i.test(c) || /^netstat\s/i.test(c), msg: '使用 ss 或 netstat 命令' },
                    { pass: /\-[a-z]*t[a-z]*/i.test(c), msg: '包含 -t 过滤TCP连接' },
                    { pass: /\-[a-z]*l[a-z]*/i.test(c), msg: '包含 -l 只显示监听状态' },
                    { pass: /\-[a-z]*p[a-z]*/i.test(c), msg: '包含 -p 显示进程信息' }
                ];
            }
        },
        context: `
            <div class="context-label">常见端口号：</div>
            <div class="scenario-block">22    → SSH
80    → HTTP
443   → HTTPS
3306  → MySQL
5432  → PostgreSQL
6379  → Redis
8080  → 常用代理/应用端口
27017 → MongoDB</div>
        `
    },
    {
        id: 12, phase: 2,
        title: 'DNS查询',
        description: '学习域名解析和DNS查询',
        tutorial: `
            <p><code>nslookup</code> 在两个系统中都可用，用于查询域名的DNS记录。</p>
            <div class="syntax-block">nslookup 域名           # 查询域名对应的IP
nslookup 域名 DNS服务器  # 使用指定DNS服务器查询</div>
            <p>Linux 下还可用更强大的 <code>dig</code> 命令：</p>
            <div class="syntax-block linux-block">dig 域名               # 详细DNS查询
dig 域名 +short        # 只显示IP结果
dig @8.8.8.8 域名      # 指定DNS服务器</div>
        `,
        win: {
            task: '请输入查询 <code>www.baidu.com</code> 域名解析结果的命令。',
            hint: '使用 nslookup www.baidu.com',
            answer: 'nslookup www.baidu.com',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^nslookup\s/i.test(c), msg: '使用 nslookup 命令' },
                    { pass: /www\.baidu\.com/i.test(c), msg: '查询目标为 www.baidu.com' }
                ];
            }
        },
        linux: {
            task: '请输入使用 <code>8.8.8.8</code> DNS服务器查询 <code>www.baidu.com</code> 并只显示简短结果的命令。',
            hint: '使用 dig @8.8.8.8 www.baidu.com +short',
            answer: 'dig @8.8.8.8 www.baidu.com +short',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^dig\s/i.test(c), msg: '使用 dig 命令' },
                    { pass: /@8\.8\.8\.8/.test(c), msg: '指定DNS服务器为 @8.8.8.8' },
                    { pass: /www\.baidu\.com/i.test(c), msg: '查询目标为 www.baidu.com' },
                    { pass: /\+short/i.test(c), msg: '使用 +short 只显示简短结果' }
                ];
            }
        },
        context: `
            <div class="context-label">常用公共DNS：</div>
            <div class="scenario-block">8.8.8.8       → Google DNS
114.114.114.114 → 国内公共DNS
223.5.5.5     → 阿里DNS
1.1.1.1       → Cloudflare DNS</div>
        `
    },
    {
        id: 13, phase: 2,
        title: '路由追踪',
        description: '学习追踪网络数据包经过的路径',
        tutorial: `
            <p>路由追踪可以显示数据包从本机到目标主机经过的每一个路由器节点，用于排查网络延迟和丢包问题。</p>
            <p><span class="os-label linux">Linux</span></p>
            <div class="syntax-block linux-block">traceroute 目标地址       # 追踪路由
traceroute -n 目标地址    # 不解析域名，加快速度</div>
            <p><span class="os-label win">Windows</span></p>
            <div class="syntax-block win-block">tracert 目标地址          # 追踪路由
tracert -d 目标地址       # 不解析域名</div>
        `,
        win: {
            task: '请输入追踪到 <code>www.google.com</code> 的网络路由路径（不解析域名）的命令。',
            hint: '使用 tracert -d www.google.com',
            answer: 'tracert -d www.google.com',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^tracert\s/i.test(c), msg: '使用 tracert 命令' },
                    { pass: /\-d/i.test(c), msg: '使用 -d 参数不解析域名' },
                    { pass: /www\.google\.com/i.test(c), msg: '目标为 www.google.com' }
                ];
            }
        },
        linux: {
            task: '请输入追踪到 <code>www.google.com</code> 的网络路由路径（不解析域名）的命令。',
            hint: '使用 traceroute -n www.google.com',
            answer: 'traceroute -n www.google.com',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^traceroute\s/i.test(c), msg: '使用 traceroute 命令' },
                    { pass: /\-n/.test(c), msg: '使用 -n 参数不解析域名' },
                    { pass: /www\.google\.com/i.test(c), msg: '目标为 www.google.com' }
                ];
            }
        },
        context: `
            <div class="context-label">traceroute 输出示例：</div>
            <div class="cmd-block"> 1  192.168.1.1    1.2ms  → 本地网关
 2  10.0.0.1      5.3ms  → ISP路由
 3  * * *                → 超时/被屏蔽
 4  72.14.213.1   15.2ms → 中间路由
 5  8.8.8.8       18.7ms → 目标主机</div>
        `
    },
    {
        id: 14, phase: 2,
        title: 'curl 网络请求',
        description: '学习使用 curl 发送HTTP请求和下载文件',
        tutorial: `
            <p><code>curl</code> 是一个强大的命令行HTTP客户端（Windows 10+ 和 Linux 均可用）。</p>
            <div class="syntax-block">curl URL                           # GET请求
curl -o 文件名 URL                 # 下载文件并保存
curl -I URL                        # 只获取响应头
curl -X POST -d "data" URL         # POST请求
curl -H "Content-Type: application/json" \\
     -d '{"key":"val"}' URL        # 发JSON</div>
        `,
        win: {
            task: '请输入向 <code>https://api.example.com/users</code> 发送 POST 请求，请求体为 <code>{"name":"test"}</code>，Content-Type 为 <code>application/json</code> 的命令。',
            hint: 'curl -X POST -H "Content-Type: application/json" -d "{\\"name\\":\\"test\\"}" https://api.example.com/users',
            answer: 'curl -X POST -H "Content-Type: application/json" -d "{\\"name\\":\\"test\\"}" https://api.example.com/users',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^curl\s/i.test(c), msg: '使用 curl 命令' },
                    { pass: /\-X\s*POST/i.test(c), msg: '使用 -X POST 指定POST方法' },
                    { pass: /\-H\s/i.test(c) && /Content-Type/i.test(c) && /application\/json/i.test(c), msg: '设置 Content-Type: application/json 头' },
                    { pass: /\-d\s/i.test(c), msg: '使用 -d 传递请求数据' },
                    { pass: /api\.example\.com\/users/i.test(c), msg: '请求URL正确' }
                ];
            }
        },
        linux: {
            task: '请输入向 <code>https://api.example.com/users</code> 发送 POST 请求，请求体为 <code>{"name":"test"}</code>，Content-Type 为 <code>application/json</code> 的命令。',
            hint: 'curl -X POST -H "Content-Type: application/json" -d \'{"name":"test"}\' https://api.example.com/users',
            answer: 'curl -X POST -H "Content-Type: application/json" -d \'{"name":"test"}\' https://api.example.com/users',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^curl\s/i.test(c), msg: '使用 curl 命令' },
                    { pass: /\-X\s*POST/i.test(c), msg: '使用 -X POST 指定POST方法' },
                    { pass: /\-H\s/i.test(c) && /Content-Type/i.test(c) && /application\/json/i.test(c), msg: '设置 Content-Type: application/json 头' },
                    { pass: /\-d\s/i.test(c), msg: '使用 -d 传递请求数据' },
                    { pass: /api\.example\.com\/users/i.test(c), msg: '请求URL正确' }
                ];
            }
        },
        context: `
            <div class="context-label">curl 常用参数速查：</div>
            <div class="scenario-block">-o 文件名    下载保存到文件
-O           使用远程文件名保存
-I           只显示响应头
-L           跟随重定向
-s           静默模式
-v           显示详细过程
-k           忽略SSL证书验证
-u user:pass HTTP基本认证</div>
        `
    },

    // ===== 第三阶段：服务器运维 =====
    {
        id: 15, phase: 3,
        title: '进程管理',
        description: '学习查看和管理系统进程',
        tutorial: `
            <p><span class="os-label linux">Linux</span></p>
            <div class="syntax-block linux-block">ps aux               # 列出所有进程
ps aux | grep 名称   # 查找特定进程
kill PID             # 正常终止进程
kill -9 PID          # 强制终止进程
top                  # 实时进程监控</div>
            <p><span class="os-label win">Windows</span></p>
            <div class="syntax-block win-block">tasklist              # 列出所有进程
tasklist | findstr 名称  # 查找特定进程
taskkill /PID 进程号 /F  # 强制终止进程
taskkill /IM 进程名 /F   # 按名称终止</div>
        `,
        win: {
            task: '请输入强制终止进程名为 <code>nginx.exe</code> 的所有进程的命令。',
            hint: '使用 taskkill /IM nginx.exe /F',
            answer: 'taskkill /IM nginx.exe /F',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^taskkill\s/i.test(c), msg: '使用 taskkill 命令' },
                    { pass: /\/IM/i.test(c), msg: '使用 /IM 按进程名终止' },
                    { pass: /nginx\.exe/i.test(c), msg: '目标进程为 nginx.exe' },
                    { pass: /\/F/i.test(c), msg: '使用 /F 强制终止' }
                ];
            }
        },
        linux: {
            task: '请输入强制终止 PID 为 <code>3721</code> 的进程的命令。',
            hint: '使用 kill -9 3721',
            answer: 'kill -9 3721',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^kill\s/i.test(c), msg: '使用 kill 命令' },
                    { pass: /\-9/.test(c), msg: '使用 -9 信号强制终止' },
                    { pass: /3721/.test(c), msg: '目标PID为 3721' }
                ];
            }
        },
        context: `
            <div class="context-label">Linux 常用信号：</div>
            <div class="scenario-block">kill -15 PID  → SIGTERM 请求正常退出（默认）
kill -9  PID  → SIGKILL 强制立即终止
kill -1  PID  → SIGHUP  重新加载配置

先尝试 kill PID，不响应再用 kill -9</div>
        `
    },
    {
        id: 16, phase: 3,
        title: '服务管理',
        description: '学习启动、停止和管理系统服务',
        tutorial: `
            <p><span class="os-label linux">Linux (systemctl)</span></p>
            <div class="syntax-block linux-block">systemctl start 服务名     # 启动服务
systemctl stop 服务名      # 停止服务
systemctl restart 服务名   # 重启服务
systemctl status 服务名    # 查看服务状态
systemctl enable 服务名    # 设置开机自启
systemctl disable 服务名   # 取消开机自启</div>
            <p><span class="os-label win">Windows</span></p>
            <div class="syntax-block win-block">net start 服务名       # 启动服务
net stop 服务名        # 停止服务
sc query 服务名        # 查看服务状态
sc config 服务名 start=auto  # 设置自动启动</div>
        `,
        win: {
            task: '请输入启动 <code>MySQL</code> 服务的命令。',
            hint: '使用 net start MySQL',
            answer: 'net start MySQL',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^net\s+start\s/i.test(c), msg: '使用 net start 命令' },
                    { pass: /mysql/i.test(c), msg: '目标服务为 MySQL' }
                ];
            }
        },
        linux: {
            task: '请输入重启 <code>nginx</code> 服务并查看其运行状态的命令（两条命令用 <code>&&</code> 连接）。',
            hint: '使用 systemctl restart nginx && systemctl status nginx',
            answer: 'systemctl restart nginx && systemctl status nginx',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /systemctl\s+restart\s+nginx/i.test(c), msg: '使用 systemctl restart nginx 重启服务' },
                    { pass: /&&/.test(c), msg: '使用 && 连接多条命令' },
                    { pass: /systemctl\s+status\s+nginx/i.test(c), msg: '使用 systemctl status nginx 查看状态' }
                ];
            }
        },
        context: `
            <div class="context-label">常见服务名称：</div>
            <div class="scenario-block">nginx        → Web服务器
mysql / mysqld → MySQL数据库
postgresql   → PostgreSQL数据库
redis        → Redis缓存
docker       → Docker引擎
sshd         → SSH服务
firewalld    → 防火墙</div>
        `
    },
    {
        id: 17, phase: 3,
        title: '日志查看',
        description: '学习查看和分析系统日志',
        tutorial: `
            <p><span class="os-label linux">Linux (journalctl)</span></p>
            <div class="syntax-block linux-block">journalctl -u 服务名           # 查看指定服务日志
journalctl -u 服务名 -f        # 实时跟踪服务日志
journalctl -u 服务名 --since "1 hour ago"  # 最近1小时
journalctl -u 服务名 -n 100    # 最近100行</div>
            <p><span class="os-label win">Windows</span></p>
            <div class="syntax-block win-block">wevtutil qe System /c:20 /f:text   # 查看系统日志最近20条
eventvwr                             # 打开事件查看器(GUI)</div>
            <p>也可以直接查看日志文件：</p>
            <div class="syntax-block">tail -f /var/log/nginx/error.log   # 实时看Nginx错误日志</div>
        `,
        win: {
            task: '请输入查看 <code>System</code> 日志最近 <code>50</code> 条记录（文本格式）的命令。',
            hint: '使用 wevtutil qe System /c:50 /f:text',
            answer: 'wevtutil qe System /c:50 /f:text',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^wevtutil\s+qe\s/i.test(c), msg: '使用 wevtutil qe 查询事件日志' },
                    { pass: /System/i.test(c), msg: '查询 System 日志' },
                    { pass: /\/c:50/i.test(c), msg: '限制显示50条' },
                    { pass: /\/f:text/i.test(c), msg: '以文本格式输出' }
                ];
            }
        },
        linux: {
            task: '请输入实时跟踪 <code>nginx</code> 服务日志输出的命令。',
            hint: '使用 journalctl -u nginx -f',
            answer: 'journalctl -u nginx -f',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^journalctl\s/i.test(c), msg: '使用 journalctl 命令' },
                    { pass: /\-u\s+nginx/i.test(c), msg: '使用 -u nginx 指定服务' },
                    { pass: /\-f/.test(c), msg: '使用 -f 参数实时跟踪' }
                ];
            }
        },
        context: `
            <div class="context-label">Linux 常用日志文件路径：</div>
            <div class="scenario-block">/var/log/syslog       → 系统通用日志
/var/log/auth.log     → 登录认证日志
/var/log/nginx/       → Nginx日志目录
/var/log/mysql/       → MySQL日志目录
/var/log/messages     → 系统消息(CentOS)</div>
        `
    },
    {
        id: 18, phase: 3,
        title: '定时任务',
        description: '学习创建定时执行的计划任务',
        tutorial: `
            <p><span class="os-label linux">Linux (crontab)</span></p>
            <div class="syntax-block linux-block">crontab -l             # 列出当前用户的定时任务
crontab -e             # 编辑定时任务

# cron 表达式格式：
# 分 时 日 月 星期 命令
# 0  2  *  *  *    /backup.sh   → 每天凌晨2点
# */5 *  *  *  *   /check.sh    → 每5分钟
# 0  0  1  *  *    /monthly.sh  → 每月1号</div>
            <p><span class="os-label win">Windows (schtasks)</span></p>
            <div class="syntax-block win-block">schtasks /create /tn "任务名" /tr "命令" /sc 频率 /st 时间
schtasks /query          # 查看所有计划任务
schtasks /delete /tn "任务名" /f  # 删除任务</div>
        `,
        win: {
            task: '请输入创建一个名为 <code>DailyBackup</code>、每天 <code>02:00</code> 执行 <code>C:\\backup.bat</code> 的计划任务命令。',
            hint: 'schtasks /create /tn "DailyBackup" /tr "C:\\backup.bat" /sc daily /st 02:00',
            answer: 'schtasks /create /tn "DailyBackup" /tr "C:\\backup.bat" /sc daily /st 02:00',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^schtasks\s+\/create/i.test(c), msg: '使用 schtasks /create 创建任务' },
                    { pass: /\/tn\s/i.test(c) && /DailyBackup/i.test(c), msg: '任务名为 DailyBackup' },
                    { pass: /\/tr\s/i.test(c) && /backup\.bat/i.test(c), msg: '执行命令为 C:\\backup.bat' },
                    { pass: /\/sc\s+daily/i.test(c), msg: '频率为 daily（每天）' },
                    { pass: /\/st\s+02:00/i.test(c), msg: '执行时间为 02:00' }
                ];
            }
        },
        linux: {
            task: '请输入列出当前用户所有定时任务的命令。',
            hint: '使用 crontab -l',
            answer: 'crontab -l',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^crontab\s/i.test(c), msg: '使用 crontab 命令' },
                    { pass: /\-l/.test(c), msg: '使用 -l 参数列出定时任务' }
                ];
            }
        },
        context: `
            <div class="context-label">cron 表达式速记：</div>
            <div class="scenario-block">*    每个单位（每分/每时/每天...）
*/5  每隔5个单位
1,15 第1和第15
1-5  第1到第5

示例：
30 3 * * 1-5  → 工作日每天3:30
0 */2 * * *   → 每2小时整点
0 8 1,15 * *  → 每月1号和15号8:00</div>
        `
    },
    {
        id: 19, phase: 3,
        title: 'SSH远程连接',
        description: '学习使用SSH安全连接远程服务器',
        tutorial: `
            <p>SSH（Secure Shell）是远程服务器管理的标准方式（Windows 10+ 内置 OpenSSH 客户端）。</p>
            <div class="syntax-block">ssh 用户名@主机地址              # 基本连接（默认22端口）
ssh -p 端口号 用户名@主机地址    # 指定端口连接
ssh -i 密钥文件 用户名@主机地址  # 使用密钥文件连接</div>
            <p>首次连接会提示确认主机指纹，输入 <code>yes</code> 即可。</p>
        `,
        win: {
            task: '请输入使用 <code>admin</code> 用户通过 <code>2222</code> 端口连接到 <code>192.168.1.100</code> 服务器的命令。',
            hint: '使用 ssh -p 2222 admin@192.168.1.100',
            answer: 'ssh -p 2222 admin@192.168.1.100',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^ssh\s/i.test(c), msg: '使用 ssh 命令' },
                    { pass: /\-p\s*2222/.test(c), msg: '使用 -p 2222 指定端口' },
                    { pass: /admin@192\.168\.1\.100/.test(c), msg: '连接到 admin@192.168.1.100' }
                ];
            }
        },
        linux: {
            task: '请输入使用密钥文件 <code>~/.ssh/id_rsa</code> 以 <code>root</code> 用户连接到 <code>10.0.0.5</code> 服务器的命令。',
            hint: '使用 ssh -i ~/.ssh/id_rsa root@10.0.0.5',
            answer: 'ssh -i ~/.ssh/id_rsa root@10.0.0.5',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^ssh\s/i.test(c), msg: '使用 ssh 命令' },
                    { pass: /\-i\s/.test(c) && /id_rsa/.test(c), msg: '使用 -i 指定密钥文件' },
                    { pass: /root@10\.0\.0\.5/.test(c), msg: '连接到 root@10.0.0.5' }
                ];
            }
        },
        context: `
            <div class="context-label">SSH 常用操作：</div>
            <div class="scenario-block">ssh-keygen -t rsa -b 4096
  → 生成RSA密钥对

ssh-copy-id user@host
  → 将公钥复制到远程服务器（免密登录）

~/.ssh/config 文件可以配置别名：
  Host myserver
    HostName 192.168.1.100
    User admin
    Port 2222
  然后直接 ssh myserver 即可连接</div>
        `
    },
    {
        id: 20, phase: 3,
        title: 'SCP远程文件传输',
        description: '学习在本地和远程服务器间传输文件',
        tutorial: `
            <p><code>scp</code>（Secure Copy）基于 SSH 协议传输文件，两个系统都可用。</p>
            <div class="syntax-block">scp 本地文件 用户@主机:远程路径     # 上传文件
scp 用户@主机:远程文件 本地路径     # 下载文件
scp -r 本地目录 用户@主机:远程路径  # 递归上传目录
scp -P 端口 ...                   # 指定端口(注意是大写P)</div>
            <p>Linux 下也可以使用更高效的 <code>rsync</code>：</p>
            <div class="syntax-block linux-block">rsync -avz 源 用户@主机:目标       # 增量同步</div>
        `,
        win: {
            task: '请输入将本地 <code>deploy.zip</code> 上传到 <code>root@192.168.1.10</code> 服务器的 <code>/opt/</code> 目录的命令。',
            hint: '使用 scp deploy.zip root@192.168.1.10:/opt/',
            answer: 'scp deploy.zip root@192.168.1.10:/opt/',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^scp\s/i.test(c), msg: '使用 scp 命令' },
                    { pass: /deploy\.zip/i.test(c), msg: '源文件为 deploy.zip' },
                    { pass: /root@192\.168\.1\.10/i.test(c), msg: '目标主机为 root@192.168.1.10' },
                    { pass: /:\s*\/opt\//i.test(c), msg: '远程目标路径为 /opt/' }
                ];
            }
        },
        linux: {
            task: '请输入将本地 <code>./dist/</code> 目录递归上传到 <code>deploy@web-server:/var/www/html/</code> 的命令。',
            hint: '使用 scp -r ./dist/ deploy@web-server:/var/www/html/',
            answer: 'scp -r ./dist/ deploy@web-server:/var/www/html/',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^scp\s/i.test(c), msg: '使用 scp 命令' },
                    { pass: /\-r/.test(c), msg: '使用 -r 递归传输目录' },
                    { pass: /dist/i.test(c), msg: '源目录为 ./dist/' },
                    { pass: /deploy@web-server/i.test(c), msg: '目标主机为 deploy@web-server' },
                    { pass: /\/var\/www\/html/i.test(c), msg: '远程路径为 /var/www/html/' }
                ];
            }
        },
        context: `
            <div class="context-label">scp vs rsync：</div>
            <div class="scenario-block">scp：简单直接，每次全量复制
rsync：增量传输，只传变化的部分
  -a 归档模式（保留权限等）
  -v 显示详情
  -z 传输时压缩
  --delete 删除目标端多余文件

大文件或频繁同步场景推荐用 rsync</div>
        `
    },

    // ===== 第四阶段：Docker管理 =====
    {
        id: 21, phase: 4,
        title: 'Docker镜像管理',
        description: '学习拉取、查看和删除Docker镜像',
        tutorial: `
            <p>Docker 镜像是容器的模板。以下命令在 Windows 和 Linux 下通用。</p>
            <div class="syntax-block">docker images                # 列出本地所有镜像
docker pull 镜像名:标签      # 从仓库拉取镜像
docker rmi 镜像ID            # 删除镜像
docker search 关键词         # 搜索Docker Hub镜像</div>
            <p>镜像名格式：<code>仓库名:标签</code>，标签默认为 <code>latest</code>。</p>
        `,
        win: {
            task: '请输入从Docker Hub拉取 <code>nginx</code> 最新版镜像的命令。',
            hint: '使用 docker pull nginx:latest 或 docker pull nginx',
            answer: 'docker pull nginx',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^docker\s+pull\s/i.test(c), msg: '使用 docker pull 命令' },
                    { pass: /nginx/i.test(c), msg: '拉取 nginx 镜像' }
                ];
            }
        },
        linux: {
            task: '请输入从Docker Hub拉取 <code>mysql:8.0</code> 镜像的命令。',
            hint: '使用 docker pull mysql:8.0',
            answer: 'docker pull mysql:8.0',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^docker\s+pull\s/i.test(c), msg: '使用 docker pull 命令' },
                    { pass: /mysql/i.test(c), msg: '拉取 mysql 镜像' },
                    { pass: /8\.0/.test(c), msg: '指定版本标签为 8.0' }
                ];
            }
        },
        context: `
            <div class="context-label">常用官方镜像：</div>
            <div class="scenario-block">nginx        → Web服务器/反向代理
mysql:8.0    → MySQL数据库
postgres:15  → PostgreSQL数据库
redis:7      → Redis缓存
node:18      → Node.js运行时
python:3.11  → Python运行时
openjdk:17   → Java运行时</div>
        `
    },
    {
        id: 22, phase: 4,
        title: 'Docker运行容器',
        description: '学习创建和启动Docker容器',
        tutorial: `
            <p><code>docker run</code> 用于创建并启动容器：</p>
            <div class="syntax-block">docker run [选项] 镜像名 [命令]

常用选项：
  -d          # 后台运行（守护模式）
  --name 名称 # 指定容器名
  -p 主机端口:容器端口  # 端口映射
  -v 主机路径:容器路径  # 目录挂载
  -e KEY=VAL  # 设置环境变量
  --restart always  # 自动重启</div>
        `,
        win: {
            task: '请输入后台运行一个 <code>nginx</code> 容器，命名为 <code>web</code>，将主机 <code>8080</code> 端口映射到容器 <code>80</code> 端口的命令。',
            hint: '使用 docker run -d --name web -p 8080:80 nginx',
            answer: 'docker run -d --name web -p 8080:80 nginx',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^docker\s+run\s/i.test(c), msg: '使用 docker run 命令' },
                    { pass: /\-d/.test(c), msg: '使用 -d 后台运行' },
                    { pass: /--name\s+web/i.test(c), msg: '容器命名为 web' },
                    { pass: /\-p\s+8080:80/.test(c), msg: '端口映射 8080:80' },
                    { pass: /nginx/i.test(c), msg: '使用 nginx 镜像' }
                ];
            }
        },
        linux: {
            task: '请输入后台运行一个 <code>mysql:8.0</code> 容器，命名为 <code>mydb</code>，映射 <code>3306:3306</code> 端口，设置环境变量 <code>MYSQL_ROOT_PASSWORD=123456</code>的命令。',
            hint: 'docker run -d --name mydb -p 3306:3306 -e MYSQL_ROOT_PASSWORD=123456 mysql:8.0',
            answer: 'docker run -d --name mydb -p 3306:3306 -e MYSQL_ROOT_PASSWORD=123456 mysql:8.0',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^docker\s+run\s/i.test(c), msg: '使用 docker run 命令' },
                    { pass: /\-d/.test(c), msg: '使用 -d 后台运行' },
                    { pass: /--name\s+mydb/i.test(c), msg: '容器命名为 mydb' },
                    { pass: /\-p\s+3306:3306/.test(c), msg: '端口映射 3306:3306' },
                    { pass: /\-e\s+MYSQL_ROOT_PASSWORD=123456/i.test(c), msg: '设置 MYSQL_ROOT_PASSWORD 环境变量' },
                    { pass: /mysql:8\.0/i.test(c), msg: '使用 mysql:8.0 镜像' }
                ];
            }
        },
        context: `
            <div class="context-label">docker run 进阶选项：</div>
            <div class="scenario-block">-v /host/data:/container/data
  → 挂载主机目录到容器（数据持久化）

--restart always
  → 容器退出或Docker重启时自动重启

--network host
  → 容器直接使用主机网络

-it  → 交互式运行（进入容器Shell）
  docker run -it ubuntu bash</div>
        `
    },
    {
        id: 23, phase: 4,
        title: '容器生命周期管理',
        description: '学习查看、停止、重启和删除容器',
        tutorial: `
            <div class="syntax-block">docker ps                # 查看运行中的容器
docker ps -a             # 查看所有容器（含已停止）
docker stop 容器名/ID    # 停止容器
docker start 容器名/ID   # 启动已停止的容器
docker restart 容器名/ID # 重启容器
docker rm 容器名/ID      # 删除容器（需先停止）
docker rm -f 容器名/ID   # 强制删除运行中的容器</div>
        `,
        win: {
            task: '请输入停止名为 <code>web</code> 的容器，然后删除它的命令（用 <code>&&</code> 连接）。',
            hint: '使用 docker stop web && docker rm web',
            answer: 'docker stop web && docker rm web',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /docker\s+stop\s+web/i.test(c), msg: '使用 docker stop web 停止容器' },
                    { pass: /&&/.test(c), msg: '使用 && 连接命令' },
                    { pass: /docker\s+rm\s+web/i.test(c), msg: '使用 docker rm web 删除容器' }
                ];
            }
        },
        linux: {
            task: '请输入查看所有容器（包含已停止的）的命令。',
            hint: '使用 docker ps -a',
            answer: 'docker ps -a',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^docker\s+ps/i.test(c), msg: '使用 docker ps 命令' },
                    { pass: /\-a/.test(c), msg: '使用 -a 显示所有容器' }
                ];
            }
        },
        context: `
            <div class="context-label">批量操作技巧：</div>
            <div class="cmd-block"># 停止所有运行中的容器
docker stop $(docker ps -q)

# 删除所有已停止的容器
docker container prune

# 删除所有未使用的镜像、容器、网络
docker system prune -a</div>
        `
    },
    {
        id: 24, phase: 4,
        title: '容器交互与日志',
        description: '学习进入容器执行命令和查看日志',
        tutorial: `
            <div class="syntax-block">docker exec -it 容器名 命令   # 在运行中的容器内执行命令
docker exec -it 容器名 bash  # 进入容器的Shell
docker exec -it 容器名 sh    # 进入容器Shell(无bash时)

docker logs 容器名           # 查看容器日志
docker logs -f 容器名        # 实时跟踪日志
docker logs --tail 100 容器名 # 最后100行日志</div>
        `,
        win: {
            task: '请输入进入名为 <code>mydb</code> 容器的 bash Shell 的命令。',
            hint: '使用 docker exec -it mydb bash',
            answer: 'docker exec -it mydb bash',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^docker\s+exec/i.test(c), msg: '使用 docker exec 命令' },
                    { pass: /\-it/.test(c) || /\-i\s+-t/.test(c) || /\-ti/.test(c), msg: '使用 -it 交互式终端' },
                    { pass: /mydb/i.test(c), msg: '目标容器为 mydb' },
                    { pass: /bash/i.test(c), msg: '执行 bash 命令' }
                ];
            }
        },
        linux: {
            task: '请输入实时查看名为 <code>web</code> 容器最后 <code>200</code> 行日志的命令。',
            hint: '使用 docker logs -f --tail 200 web',
            answer: 'docker logs -f --tail 200 web',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^docker\s+logs/i.test(c), msg: '使用 docker logs 命令' },
                    { pass: /\-f/.test(c), msg: '使用 -f 实时跟踪' },
                    { pass: /--tail\s+200/.test(c), msg: '使用 --tail 200 限制行数' },
                    { pass: /web/i.test(c), msg: '目标容器为 web' }
                ];
            }
        },
        context: `
            <div class="context-label">容器内常见操作：</div>
            <div class="cmd-block"># 进入MySQL容器后连接数据库
docker exec -it mydb mysql -u root -p

# 查看容器内的文件
docker exec mydb ls /var/lib/mysql

# 从容器中复制文件到主机
docker cp mydb:/var/log/mysql.log ./mysql.log

# 从主机复制文件到容器
docker cp config.ini mydb:/etc/mysql/</div>
        `
    },
    {
        id: 25, phase: 4,
        title: 'Docker Compose',
        description: '学习使用 Docker Compose 管理多容器应用',
        tutorial: `
            <p>Docker Compose 使用 YAML 文件定义多容器应用，一键启动和管理。</p>
            <div class="syntax-block">docker compose up -d         # 后台启动所有服务
docker compose down          # 停止并删除所有容器
docker compose ps            # 查看服务状态
docker compose logs -f       # 查看所有服务日志
docker compose restart 服务名 # 重启指定服务
docker compose pull          # 拉取最新镜像</div>
            <p>配置文件默认为当前目录下的 <code>docker-compose.yml</code>。</p>
        `,
        win: {
            task: '请输入在后台启动 docker-compose.yml 中定义的所有服务的命令。',
            hint: '使用 docker compose up -d',
            answer: 'docker compose up -d',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^docker[\s-]compose\s+up/i.test(c), msg: '使用 docker compose up 启动服务' },
                    { pass: /\-d/.test(c), msg: '使用 -d 后台运行' }
                ];
            }
        },
        linux: {
            task: '请输入停止并删除所有由 Compose 创建的容器和网络的命令。',
            hint: '使用 docker compose down',
            answer: 'docker compose down',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^docker[\s-]compose\s+down/i.test(c), msg: '使用 docker compose down 清理资源' }
                ];
            }
        },
        context: `
            <div class="context-label">docker-compose.yml 示例：</div>
            <div class="cmd-block">version: '3.8'
services:
  web:
    image: nginx
    ports:
      - "80:80"
    volumes:
      - ./html:/usr/share/nginx/html
  db:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: secret
    volumes:
      - db_data:/var/lib/mysql
volumes:
  db_data:</div>
        `
    },

    // ===== 第五阶段：数据库导入导出 =====
    {
        id: 26, phase: 5,
        title: 'MySQL数据导出',
        description: '学习使用mysqldump导出MySQL数据库',
        tutorial: `
            <p><code>mysqldump</code> 是 MySQL 官方提供的逻辑备份工具。</p>
            <div class="syntax-block">mysqldump -u 用户 -p 数据库名 > 备份.sql
# 导出整个数据库

mysqldump -u 用户 -p 数据库名 表名 > 表备份.sql
# 导出指定表

mysqldump -u 用户 -p --all-databases > all_backup.sql
# 导出所有数据库

mysqldump -u 用户 -p -d 数据库名 > schema.sql
# 仅导出结构（不含数据）</div>
            <p>参数 <code>-p</code> 后不跟密码会交互式输入（更安全）。</p>
        `,
        win: {
            task: '请输入导出 <code>myapp</code> 数据库全部内容到 <code>myapp_backup.sql</code> 文件的命令（用户为 <code>root</code>）。',
            hint: '使用 mysqldump -u root -p myapp > myapp_backup.sql',
            answer: 'mysqldump -u root -p myapp > myapp_backup.sql',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^mysqldump\s/i.test(c), msg: '使用 mysqldump 命令' },
                    { pass: /\-u\s*root/i.test(c), msg: '指定用户为 root' },
                    { pass: /\-p/.test(c), msg: '包含 -p 参数（输入密码）' },
                    { pass: /myapp/i.test(c), msg: '目标数据库为 myapp' },
                    { pass: />\s*myapp_backup\.sql/i.test(c), msg: '输出到 myapp_backup.sql' }
                ];
            }
        },
        linux: {
            task: '请输入仅导出 <code>production</code> 数据库的表结构（不含数据）到 <code>schema.sql</code> 的命令（用户为 <code>root</code>）。',
            hint: '使用 mysqldump -u root -p -d production > schema.sql',
            answer: 'mysqldump -u root -p -d production > schema.sql',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^mysqldump\s/i.test(c), msg: '使用 mysqldump 命令' },
                    { pass: /\-u\s*root/i.test(c), msg: '指定用户为 root' },
                    { pass: /\-p/.test(c), msg: '包含 -p 参数' },
                    { pass: /\-d/.test(c), msg: '使用 -d 仅导出结构' },
                    { pass: /production/i.test(c), msg: '目标数据库为 production' },
                    { pass: />\s*schema\.sql/i.test(c), msg: '输出到 schema.sql' }
                ];
            }
        },
        context: `
            <div class="context-label">mysqldump 常用参数：</div>
            <div class="scenario-block">-d               仅结构不含数据
--no-create-info  仅数据不含建表语句
--single-transaction  InnoDB一致性备份
--routines        导出存储过程和函数
--triggers        导出触发器（默认包含）
--where="条件"    按条件导出部分数据
--compress        压缩传输（远程导出时）</div>
        `
    },
    {
        id: 27, phase: 5,
        title: 'MySQL数据导入',
        description: '学习将SQL文件导入MySQL数据库',
        tutorial: `
            <p>有两种常用方式将 SQL 文件导入 MySQL：</p>
            <div class="syntax-block">mysql -u 用户 -p 数据库名 < 备份.sql
# 方式一：命令行重定向导入

# 方式二：登录MySQL后使用source
mysql> source /path/to/backup.sql;
mysql> \\. /path/to/backup.sql;</div>
            <p>导入前通常需要先创建目标数据库：</p>
            <div class="syntax-block">mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS myapp;"
mysql -u root -p myapp < backup.sql</div>
        `,
        win: {
            task: '请输入将 <code>backup.sql</code> 导入到 <code>myapp</code> 数据库的命令（用户为 <code>root</code>）。',
            hint: '使用 mysql -u root -p myapp < backup.sql',
            answer: 'mysql -u root -p myapp < backup.sql',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^mysql\s/i.test(c), msg: '使用 mysql 命令' },
                    { pass: /\-u\s*root/i.test(c), msg: '指定用户为 root' },
                    { pass: /\-p/.test(c), msg: '包含 -p 参数' },
                    { pass: /myapp/i.test(c), msg: '目标数据库为 myapp' },
                    { pass: /<\s*backup\.sql/i.test(c), msg: '从 backup.sql 导入' }
                ];
            }
        },
        linux: {
            task: '请输入将 <code>backup.sql</code> 导入到 <code>myapp</code> 数据库的命令（用户为 <code>root</code>）。',
            hint: '使用 mysql -u root -p myapp < backup.sql',
            answer: 'mysql -u root -p myapp < backup.sql',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^mysql\s/i.test(c), msg: '使用 mysql 命令' },
                    { pass: /\-u\s*root/i.test(c), msg: '指定用户为 root' },
                    { pass: /\-p/.test(c), msg: '包含 -p 参数' },
                    { pass: /myapp/i.test(c), msg: '目标数据库为 myapp' },
                    { pass: /<\s*backup\.sql/i.test(c), msg: '从 backup.sql 导入' }
                ];
            }
        },
        context: `
            <div class="context-label">Docker中的MySQL导入导出：</div>
            <div class="cmd-block"># 从Docker容器中导出
docker exec mydb mysqldump -u root -p123 myapp > backup.sql

# 导入到Docker容器中
docker exec -i mydb mysql -u root -p123 myapp < backup.sql</div>
        `
    },
    {
        id: 28, phase: 5,
        title: 'PostgreSQL导入导出',
        description: '学习PostgreSQL数据库的备份和恢复',
        tutorial: `
            <p><span class="os-label linux">导出（pg_dump）</span></p>
            <div class="syntax-block">pg_dump -U 用户 数据库名 > 备份.sql
# 导出为SQL格式

pg_dump -U 用户 -Fc 数据库名 > 备份.dump
# 导出为自定义压缩格式（推荐用于大数据库）

pg_dump -U 用户 -t 表名 数据库名 > 表备份.sql
# 导出指定表</div>
            <p><span class="os-label linux">导入（psql / pg_restore）</span></p>
            <div class="syntax-block">psql -U 用户 数据库名 < 备份.sql
# 导入SQL格式

pg_restore -U 用户 -d 数据库名 备份.dump
# 恢复自定义格式备份</div>
        `,
        win: {
            task: '请输入使用 <code>postgres</code> 用户导出 <code>webapp</code> 数据库为自定义压缩格式到 <code>webapp.dump</code> 的命令。',
            hint: '使用 pg_dump -U postgres -Fc webapp > webapp.dump',
            answer: 'pg_dump -U postgres -Fc webapp > webapp.dump',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^pg_dump\s/i.test(c), msg: '使用 pg_dump 命令' },
                    { pass: /\-U\s*postgres/i.test(c), msg: '指定用户为 postgres' },
                    { pass: /\-Fc/i.test(c), msg: '使用 -Fc 自定义压缩格式' },
                    { pass: /webapp/i.test(c), msg: '目标数据库为 webapp' },
                    { pass: />\s*webapp\.dump/i.test(c), msg: '输出到 webapp.dump' }
                ];
            }
        },
        linux: {
            task: '请输入使用 <code>pg_restore</code> 将 <code>webapp.dump</code> 恢复到 <code>webapp_new</code> 数据库的命令（用户为 <code>postgres</code>）。',
            hint: '使用 pg_restore -U postgres -d webapp_new webapp.dump',
            answer: 'pg_restore -U postgres -d webapp_new webapp.dump',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^pg_restore\s/i.test(c), msg: '使用 pg_restore 命令' },
                    { pass: /\-U\s*postgres/i.test(c), msg: '指定用户为 postgres' },
                    { pass: /\-d\s*webapp_new/i.test(c), msg: '目标数据库为 webapp_new' },
                    { pass: /webapp\.dump/i.test(c), msg: '备份文件为 webapp.dump' }
                ];
            }
        },
        context: `
            <div class="context-label">pg_dump 格式对比：</div>
            <div class="scenario-block">SQL格式 (默认)：
  可读性强，可手动编辑
  用 psql 导入

自定义格式 (-Fc)：
  自动压缩，体积小
  支持并行恢复 (-j 4)
  用 pg_restore 导入

目录格式 (-Fd)：
  导出为目录结构
  支持并行导出和导入</div>
        `
    },
    {
        id: 29, phase: 5,
        title: 'MongoDB导入导出',
        description: '学习MongoDB数据库的备份和恢复',
        tutorial: `
            <p><span class="os-label linux">二进制备份（推荐用于完整备份）</span></p>
            <div class="syntax-block">mongodump --db 数据库名 --out 备份目录
# 导出数据库到BSON文件

mongorestore --db 数据库名 备份目录/数据库名
# 从BSON恢复数据库</div>
            <p><span class="os-label linux">JSON格式导入导出</span></p>
            <div class="syntax-block">mongoexport --db 库名 --collection 集合名 --out 文件.json
# 导出集合为JSON

mongoimport --db 库名 --collection 集合名 --file 文件.json
# 导入JSON到集合</div>
        `,
        win: {
            task: '请输入将 <code>mydb</code> 数据库完整备份到 <code>./backup</code> 目录的命令。',
            hint: '使用 mongodump --db mydb --out ./backup',
            answer: 'mongodump --db mydb --out ./backup',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^mongodump\s/i.test(c), msg: '使用 mongodump 命令' },
                    { pass: /--db\s+mydb/i.test(c), msg: '指定数据库为 mydb' },
                    { pass: /--out\s/i.test(c) && /backup/i.test(c), msg: '输出到 backup 目录' }
                ];
            }
        },
        linux: {
            task: '请输入将 <code>logs</code> 数据库的 <code>events</code> 集合导出为 <code>events.json</code> 文件的命令。',
            hint: '使用 mongoexport --db logs --collection events --out events.json',
            answer: 'mongoexport --db logs --collection events --out events.json',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^mongoexport\s/i.test(c), msg: '使用 mongoexport 命令' },
                    { pass: /--db\s+logs/i.test(c), msg: '指定数据库为 logs' },
                    { pass: /--collection\s+events/i.test(c), msg: '指定集合为 events' },
                    { pass: /--out\s+events\.json/i.test(c), msg: '输出到 events.json' }
                ];
            }
        },
        context: `
            <div class="context-label">带认证的导出命令：</div>
            <div class="cmd-block">mongodump --host 127.0.0.1 --port 27017 \\
  --username admin --password secret \\
  --authenticationDatabase admin \\
  --db mydb --out ./backup

# Docker 容器中的 MongoDB
docker exec mydb mongodump --db mydb --out /backup
docker cp mydb:/backup ./local_backup</div>
        `
    },
    {
        id: 30, phase: 5,
        title: 'Redis备份与恢复',
        description: '学习Redis数据的备份和恢复方式',
        tutorial: `
            <p>Redis 提供两种持久化方式和命令行导入导出工具：</p>
            <div class="syntax-block">redis-cli BGSAVE           # 触发后台生成RDB快照
redis-cli LASTSAVE         # 查看最后一次保存时间

# RDB文件默认位置：/var/lib/redis/dump.rdb
# 恢复：将dump.rdb放到Redis数据目录，重启Redis

redis-cli --rdb 备份.rdb   # 远程导出RDB备份</div>
            <p>批量数据操作：</p>
            <div class="syntax-block">redis-cli -h 主机 -p 端口 -a 密码
# 连接Redis

redis-cli -h 主机 -p 端口 -a 密码 --pipe < commands.txt
# 批量导入命令</div>
        `,
        win: {
            task: '请输入连接到 <code>192.168.1.10</code> 主机的 <code>6379</code> 端口，密码为 <code>mypass</code> 的Redis命令行。',
            hint: '使用 redis-cli -h 192.168.1.10 -p 6379 -a mypass',
            answer: 'redis-cli -h 192.168.1.10 -p 6379 -a mypass',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^redis-cli\s/i.test(c), msg: '使用 redis-cli 命令' },
                    { pass: /\-h\s+192\.168\.1\.10/i.test(c), msg: '指定主机为 192.168.1.10' },
                    { pass: /\-p\s+6379/i.test(c), msg: '指定端口为 6379' },
                    { pass: /\-a\s+mypass/i.test(c), msg: '指定密码为 mypass' }
                ];
            }
        },
        linux: {
            task: '请输入触发 Redis 后台保存 RDB 快照的命令。',
            hint: '使用 redis-cli BGSAVE',
            answer: 'redis-cli BGSAVE',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^redis-cli\s/i.test(c), msg: '使用 redis-cli 命令' },
                    { pass: /BGSAVE/i.test(c), msg: '执行 BGSAVE 命令触发后台保存' }
                ];
            }
        },
        context: `
            <div class="context-label">Redis 持久化对比：</div>
            <div class="scenario-block">RDB（快照）：
  定期生成数据快照文件 dump.rdb
  恢复快，但可能丢失最后一次快照后的数据
  适合备份和灾难恢复

AOF（追加日志）：
  记录每一条写命令到 appendonly.aof
  数据更安全（可配置每秒同步）
  文件较大，恢复较慢

推荐同时开启 RDB + AOF</div>
        `
    },

    // ===== 第六阶段：Oracle数据库 =====
    {
        id: 31, phase: 6,
        title: 'SQL*Plus连接Oracle',
        description: '学习使用SQL*Plus连接Oracle数据库',
        tutorial: `
            <p><code>sqlplus</code> 是 Oracle 自带的命令行客户端工具。</p>
            <div class="syntax-block">sqlplus 用户名/密码@主机:端口/服务名
# 连接远程Oracle

sqlplus 用户名/密码
# 连接本地Oracle

sqlplus / as sysdba
# 以DBA身份连接本地（操作系统认证）

sqlplus -S 用户名/密码@服务名
# 静默模式（不显示banner）</div>
            <p>连接串也可以使用 TNS 名称（在 tnsnames.ora 中配置）：</p>
            <div class="syntax-block">sqlplus 用户名/密码@TNS名称</div>
        `,
        win: {
            task: '请输入以 <code>system</code> 用户、密码 <code>oracle123</code> 连接到 <code>192.168.1.50:1521/orcl</code> 的命令。',
            hint: '使用 sqlplus system/oracle123@192.168.1.50:1521/orcl',
            answer: 'sqlplus system/oracle123@192.168.1.50:1521/orcl',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^sqlplus\s/i.test(c), msg: '使用 sqlplus 命令' },
                    { pass: /system\/oracle123/i.test(c), msg: '用户名/密码为 system/oracle123' },
                    { pass: /@192\.168\.1\.50:1521\/orcl/i.test(c), msg: '连接到 192.168.1.50:1521/orcl' }
                ];
            }
        },
        linux: {
            task: '请输入以 DBA 身份连接本地 Oracle 数据库的命令。',
            hint: '使用 sqlplus / as sysdba',
            answer: 'sqlplus / as sysdba',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^sqlplus\s/i.test(c), msg: '使用 sqlplus 命令' },
                    { pass: /\/\s+as\s+sysdba/i.test(c), msg: '使用 / as sysdba 以DBA身份连接' }
                ];
            }
        },
        context: `
            <div class="context-label">Oracle 连接方式总结：</div>
            <div class="scenario-block">本地连接：
  sqlplus user/pass          → 使用默认实例
  sqlplus / as sysdba        → DBA操作系统认证

远程连接（Easy Connect）：
  sqlplus user/pass@host:port/service

TNS连接（需配置 tnsnames.ora）：
  sqlplus user/pass@tns_name

常用环境变量：
  ORACLE_HOME  → Oracle安装目录
  ORACLE_SID   → 默认实例名
  TNS_ADMIN    → tnsnames.ora所在目录</div>
        `
    },
    {
        id: 32, phase: 6,
        title: 'Oracle数据导出(expdp)',
        description: '学习使用Data Pump导出Oracle数据',
        tutorial: `
            <p>Oracle Data Pump 是官方推荐的高速导入导出工具，取代了旧版 <code>exp</code>/<code>imp</code>。</p>
            <div class="syntax-block">expdp 用户/密码@服务名 DIRECTORY=目录对象 \\
  DUMPFILE=文件名.dmp LOGFILE=日志.log \\
  SCHEMAS=模式名

# 导出整个模式（schema）
expdp user/pass DIRECTORY=dpdir \\
  DUMPFILE=full.dmp FULL=Y

# 导出指定表
expdp user/pass DIRECTORY=dpdir \\
  DUMPFILE=tables.dmp TABLES=表1,表2

# 仅导出结构
expdp user/pass DIRECTORY=dpdir \\
  DUMPFILE=meta.dmp SCHEMAS=hr CONTENT=METADATA_ONLY</div>
            <p><code>DIRECTORY</code> 是Oracle中预定义的目录对象，指向服务器上的物理路径。</p>
        `,
        win: {
            task: '请输入以 <code>hr/hr123@orcl</code> 身份导出 <code>HR</code> 模式到 <code>hr_backup.dmp</code>（目录对象为 <code>DPDIR</code>，日志文件为 <code>hr_exp.log</code>）的命令。',
            hint: 'expdp hr/hr123@orcl DIRECTORY=DPDIR DUMPFILE=hr_backup.dmp LOGFILE=hr_exp.log SCHEMAS=HR',
            answer: 'expdp hr/hr123@orcl DIRECTORY=DPDIR DUMPFILE=hr_backup.dmp LOGFILE=hr_exp.log SCHEMAS=HR',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^expdp\s/i.test(c), msg: '使用 expdp 命令' },
                    { pass: /hr\/hr123@orcl/i.test(c), msg: '连接信息为 hr/hr123@orcl' },
                    { pass: /DIRECTORY\s*=\s*DPDIR/i.test(c), msg: '目录对象为 DPDIR' },
                    { pass: /DUMPFILE\s*=\s*hr_backup\.dmp/i.test(c), msg: '导出文件为 hr_backup.dmp' },
                    { pass: /LOGFILE\s*=\s*hr_exp\.log/i.test(c), msg: '日志文件为 hr_exp.log' },
                    { pass: /SCHEMAS\s*=\s*HR/i.test(c), msg: '导出模式为 HR' }
                ];
            }
        },
        linux: {
            task: '请输入以 <code>system/oracle@orcl</code> 身份全库导出到 <code>full_backup.dmp</code>（目录对象为 <code>DPDIR</code>，日志文件为 <code>full_exp.log</code>）的命令。',
            hint: 'expdp system/oracle@orcl DIRECTORY=DPDIR DUMPFILE=full_backup.dmp LOGFILE=full_exp.log FULL=Y',
            answer: 'expdp system/oracle@orcl DIRECTORY=DPDIR DUMPFILE=full_backup.dmp LOGFILE=full_exp.log FULL=Y',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^expdp\s/i.test(c), msg: '使用 expdp 命令' },
                    { pass: /system\/oracle@orcl/i.test(c), msg: '连接信息为 system/oracle@orcl' },
                    { pass: /DIRECTORY\s*=\s*DPDIR/i.test(c), msg: '目录对象为 DPDIR' },
                    { pass: /DUMPFILE\s*=\s*full_backup\.dmp/i.test(c), msg: '导出文件为 full_backup.dmp' },
                    { pass: /LOGFILE\s*=\s*full_exp\.log/i.test(c), msg: '日志文件为 full_exp.log' },
                    { pass: /FULL\s*=\s*Y/i.test(c), msg: '使用 FULL=Y 全库导出' }
                ];
            }
        },
        context: `
            <div class="context-label">创建目录对象：</div>
            <div class="cmd-block">-- 在 sqlplus 中执行
CREATE OR REPLACE DIRECTORY DPDIR
  AS '/opt/oracle/backup';

GRANT READ, WRITE ON DIRECTORY DPDIR TO hr;</div>
            <div class="context-label">expdp 常用参数：</div>
            <div class="scenario-block">SCHEMAS=模式名     导出指定模式
TABLES=表名        导出指定表
FULL=Y             全库导出
CONTENT=ALL        导出结构和数据（默认）
CONTENT=DATA_ONLY  仅数据
CONTENT=METADATA_ONLY  仅结构
PARALLEL=4         并行度（加速大库导出）
EXCLUDE=TABLE:"IN('TEMP')"  排除指定表</div>
        `
    },
    {
        id: 33, phase: 6,
        title: 'Oracle数据导入(impdp)',
        description: '学习使用Data Pump导入Oracle数据',
        tutorial: `
            <p><code>impdp</code> 将 Data Pump 导出的 .dmp 文件导入到 Oracle 数据库。</p>
            <div class="syntax-block">impdp 用户/密码@服务名 DIRECTORY=目录对象 \\
  DUMPFILE=文件名.dmp LOGFILE=日志.log

# 导入到同名模式
impdp user/pass DIRECTORY=dpdir \\
  DUMPFILE=hr.dmp SCHEMAS=HR

# 重映射模式（导入到不同用户）
impdp user/pass DIRECTORY=dpdir \\
  DUMPFILE=hr.dmp REMAP_SCHEMA=HR:NEW_HR

# 重映射表空间
impdp user/pass DIRECTORY=dpdir \\
  DUMPFILE=hr.dmp REMAP_TABLESPACE=USERS:NEW_TS

# 仅导入结构
impdp user/pass DIRECTORY=dpdir \\
  DUMPFILE=hr.dmp CONTENT=METADATA_ONLY</div>
        `,
        win: {
            task: '请输入将 <code>hr_backup.dmp</code> 中的 <code>HR</code> 模式数据导入，并重映射到 <code>HR_TEST</code> 模式的命令（使用 <code>system/oracle@orcl</code>，目录对象 <code>DPDIR</code>，日志 <code>hr_imp.log</code>）。',
            hint: 'impdp system/oracle@orcl DIRECTORY=DPDIR DUMPFILE=hr_backup.dmp LOGFILE=hr_imp.log REMAP_SCHEMA=HR:HR_TEST',
            answer: 'impdp system/oracle@orcl DIRECTORY=DPDIR DUMPFILE=hr_backup.dmp LOGFILE=hr_imp.log REMAP_SCHEMA=HR:HR_TEST',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^impdp\s/i.test(c), msg: '使用 impdp 命令' },
                    { pass: /system\/oracle@orcl/i.test(c), msg: '连接信息为 system/oracle@orcl' },
                    { pass: /DIRECTORY\s*=\s*DPDIR/i.test(c), msg: '目录对象为 DPDIR' },
                    { pass: /DUMPFILE\s*=\s*hr_backup\.dmp/i.test(c), msg: '导入文件为 hr_backup.dmp' },
                    { pass: /LOGFILE\s*=\s*hr_imp\.log/i.test(c), msg: '日志文件为 hr_imp.log' },
                    { pass: /REMAP_SCHEMA\s*=\s*HR:HR_TEST/i.test(c), msg: '重映射模式 HR → HR_TEST' }
                ];
            }
        },
        linux: {
            task: '请输入将 <code>hr_backup.dmp</code> 导入到 <code>HR</code> 模式的命令（使用 <code>hr/hr123@orcl</code>，目录对象 <code>DPDIR</code>，日志 <code>hr_imp.log</code>）。',
            hint: 'impdp hr/hr123@orcl DIRECTORY=DPDIR DUMPFILE=hr_backup.dmp LOGFILE=hr_imp.log SCHEMAS=HR',
            answer: 'impdp hr/hr123@orcl DIRECTORY=DPDIR DUMPFILE=hr_backup.dmp LOGFILE=hr_imp.log SCHEMAS=HR',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^impdp\s/i.test(c), msg: '使用 impdp 命令' },
                    { pass: /hr\/hr123@orcl/i.test(c), msg: '连接信息为 hr/hr123@orcl' },
                    { pass: /DIRECTORY\s*=\s*DPDIR/i.test(c), msg: '目录对象为 DPDIR' },
                    { pass: /DUMPFILE\s*=\s*hr_backup\.dmp/i.test(c), msg: '导入文件为 hr_backup.dmp' },
                    { pass: /LOGFILE\s*=\s*hr_imp\.log/i.test(c), msg: '日志文件为 hr_imp.log' },
                    { pass: /SCHEMAS\s*=\s*HR/i.test(c), msg: '导入模式为 HR' }
                ];
            }
        },
        context: `
            <div class="context-label">impdp 常用参数：</div>
            <div class="scenario-block">REMAP_SCHEMA=旧:新      模式重映射
REMAP_TABLESPACE=旧:新   表空间重映射
REMAP_TABLE=旧:新        表名重映射
TABLE_EXISTS_ACTION=     表已存在时的处理：
  SKIP      跳过（默认）
  APPEND    追加数据
  REPLACE   先删除再导入
  TRUNCATE  清空再导入
PARALLEL=4               并行导入
TRANSFORM=SEGMENT_ATTRIBUTES:N
  → 忽略存储属性（跨环境迁移时常用）</div>
        `
    },
    {
        id: 34, phase: 6,
        title: 'Oracle RMAN备份',
        description: '学习使用RMAN进行Oracle物理备份',
        tutorial: `
            <p><code>RMAN</code>（Recovery Manager）是 Oracle 的物理备份和恢复工具，适合生产环境的完整备份策略。</p>
            <div class="syntax-block">rman TARGET /
# 连接本地数据库

rman TARGET sys/password@orcl
# 连接远程数据库

# 在RMAN命令行中执行：
RMAN> BACKUP DATABASE;               # 全库备份
RMAN> BACKUP DATABASE PLUS ARCHIVELOG; # 备份+归档日志
RMAN> BACKUP TABLESPACE users;       # 备份指定表空间
RMAN> BACKUP INCREMENTAL LEVEL 0 DATABASE; # 0级增量
RMAN> BACKUP INCREMENTAL LEVEL 1 DATABASE; # 1级增量</div>
        `,
        win: {
            task: '请输入以 <code>sys/oracle@orcl</code> 身份连接 RMAN 的命令。',
            hint: '使用 rman TARGET sys/oracle@orcl',
            answer: 'rman TARGET sys/oracle@orcl',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^rman\s/i.test(c), msg: '使用 rman 命令' },
                    { pass: /TARGET/i.test(c), msg: '使用 TARGET 指定目标数据库' },
                    { pass: /sys\/oracle@orcl/i.test(c), msg: '连接信息为 sys/oracle@orcl' }
                ];
            }
        },
        linux: {
            task: '请输入以操作系统认证方式连接本地 RMAN 的命令。',
            hint: '使用 rman TARGET /',
            answer: 'rman TARGET /',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^rman\s/i.test(c), msg: '使用 rman 命令' },
                    { pass: /TARGET\s+\//i.test(c), msg: '使用 TARGET / 本地认证连接' }
                ];
            }
        },
        context: `
            <div class="context-label">RMAN 备份策略示例：</div>
            <div class="cmd-block">-- 配置保留策略（保留7天）
CONFIGURE RETENTION POLICY TO
  RECOVERY WINDOW OF 7 DAYS;

-- 配置自动备份控制文件
CONFIGURE CONTROLFILE AUTOBACKUP ON;

-- 完整备份脚本
RUN {
  ALLOCATE CHANNEL c1 DEVICE TYPE DISK;
  BACKUP INCREMENTAL LEVEL 0 DATABASE
    FORMAT '/backup/full_%d_%T_%s.bak';
  BACKUP ARCHIVELOG ALL
    FORMAT '/backup/arch_%d_%T_%s.bak'
    DELETE INPUT;
  DELETE NOPROMPT OBSOLETE;
}</div>
            <div class="context-label">RMAN vs expdp：</div>
            <div class="scenario-block">RMAN（物理备份）：
  备份数据文件、控制文件、归档日志
  支持增量备份，速度快
  可恢复到任意时间点（PITR）
  适合生产环境灾难恢复

expdp（逻辑备份）：
  导出为可读的SQL/二进制格式
  支持跨平台、跨版本迁移
  可选择性导出表/模式
  适合数据迁移和开发测试</div>
        `
    },

    // ===== 第七阶段：达梦数据库 =====
    {
        id: 35, phase: 7,
        title: 'DIsql连接达梦数据库',
        description: '学习使用DIsql连接达梦数据库',
        tutorial: `
            <p><code>disql</code> 是达梦数据库自带的命令行客户端，用法与 Oracle 的 sqlplus 类似。</p>
            <div class="syntax-block">disql 用户名/密码@主机:端口
# 连接达梦数据库

disql 用户名/密码
# 连接本地达梦（默认端口5236）

disql SYSDBA/密码@localhost:5236
# 以SYSDBA连接本地

disql /nolog
# 先启动不登录，再手动连接
SQL> CONN 用户名/密码@主机:端口;</div>
            <p>达梦默认端口为 <code>5236</code>，默认管理员用户为 <code>SYSDBA</code>。</p>
        `,
        win: {
            task: '请输入以 <code>SYSDBA</code> 用户、密码 <code>SYSDBA001</code> 连接到 <code>192.168.1.60:5236</code> 的达梦数据库的命令。',
            hint: '使用 disql SYSDBA/SYSDBA001@192.168.1.60:5236',
            answer: 'disql SYSDBA/SYSDBA001@192.168.1.60:5236',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^disql\s/i.test(c), msg: '使用 disql 命令' },
                    { pass: /SYSDBA\/SYSDBA001/i.test(c), msg: '用户名/密码为 SYSDBA/SYSDBA001' },
                    { pass: /@192\.168\.1\.60:5236/i.test(c), msg: '连接到 192.168.1.60:5236' }
                ];
            }
        },
        linux: {
            task: '请输入以 <code>SYSDBA</code> 用户、密码 <code>SYSDBA001</code> 连接本地达梦数据库（默认端口）的命令。',
            hint: '使用 disql SYSDBA/SYSDBA001',
            answer: 'disql SYSDBA/SYSDBA001',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^disql\s/i.test(c), msg: '使用 disql 命令' },
                    { pass: /SYSDBA\/SYSDBA001/i.test(c), msg: '用户名/密码为 SYSDBA/SYSDBA001' }
                ];
            }
        },
        context: `
            <div class="context-label">达梦数据库常用信息：</div>
            <div class="scenario-block">默认端口：5236
默认管理员：SYSDBA
安装目录（Linux）：/opt/dmdbms
安装目录（Windows）：C:\\dmdbms

常用环境变量：
  DM_HOME    → 达梦安装目录
  PATH       → 需包含 $DM_HOME/bin

服务管理（Linux）：
  systemctl start DmServiceDMSERVER
  systemctl status DmServiceDMSERVER</div>
        `
    },
    {
        id: 36, phase: 7,
        title: '达梦数据导出(dexp)',
        description: '学习使用dexp导出达梦数据库',
        tutorial: `
            <p>达梦提供 <code>dexp</code> 逻辑导出工具，语法兼容 Oracle 风格。</p>
            <div class="syntax-block">dexp 用户/密码@主机:端口 FILE=文件.dmp LOG=日志.log \\
  SCHEMAS=模式名

# 全库导出
dexp SYSDBA/pass@localhost:5236 FILE=full.dmp \\
  LOG=full.log FULL=Y

# 导出指定模式
dexp SYSDBA/pass FILE=schema.dmp \\
  LOG=schema.log SCHEMAS=HR

# 导出指定表
dexp SYSDBA/pass FILE=tables.dmp \\
  LOG=tables.log TABLES=HR.EMPLOYEES,HR.DEPARTMENTS

# 导出指定行（带条件）
dexp SYSDBA/pass FILE=part.dmp \\
  TABLES=HR.EMPLOYEES QUERY="WHERE DEPT_ID=10"</div>
        `,
        win: {
            task: '请输入以 <code>SYSDBA/SYSDBA001@localhost:5236</code> 身份导出 <code>HR</code> 模式到 <code>hr_dm.dmp</code>（日志 <code>hr_exp.log</code>）的命令。',
            hint: 'dexp SYSDBA/SYSDBA001@localhost:5236 FILE=hr_dm.dmp LOG=hr_exp.log SCHEMAS=HR',
            answer: 'dexp SYSDBA/SYSDBA001@localhost:5236 FILE=hr_dm.dmp LOG=hr_exp.log SCHEMAS=HR',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^dexp\s/i.test(c), msg: '使用 dexp 命令' },
                    { pass: /SYSDBA\/SYSDBA001/i.test(c), msg: '连接用户为 SYSDBA/SYSDBA001' },
                    { pass: /FILE\s*=\s*hr_dm\.dmp/i.test(c), msg: '导出文件为 hr_dm.dmp' },
                    { pass: /LOG\s*=\s*hr_exp\.log/i.test(c), msg: '日志文件为 hr_exp.log' },
                    { pass: /SCHEMAS\s*=\s*HR/i.test(c), msg: '导出模式为 HR' }
                ];
            }
        },
        linux: {
            task: '请输入以 <code>SYSDBA/SYSDBA001</code> 身份全库导出到 <code>full_dm.dmp</code>（日志 <code>full_exp.log</code>）的命令。',
            hint: 'dexp SYSDBA/SYSDBA001 FILE=full_dm.dmp LOG=full_exp.log FULL=Y',
            answer: 'dexp SYSDBA/SYSDBA001 FILE=full_dm.dmp LOG=full_exp.log FULL=Y',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^dexp\s/i.test(c), msg: '使用 dexp 命令' },
                    { pass: /SYSDBA\/SYSDBA001/i.test(c), msg: '连接用户为 SYSDBA/SYSDBA001' },
                    { pass: /FILE\s*=\s*full_dm\.dmp/i.test(c), msg: '导出文件为 full_dm.dmp' },
                    { pass: /LOG\s*=\s*full_exp\.log/i.test(c), msg: '日志文件为 full_exp.log' },
                    { pass: /FULL\s*=\s*Y/i.test(c), msg: '使用 FULL=Y 全库导出' }
                ];
            }
        },
        context: `
            <div class="context-label">dexp 常用参数：</div>
            <div class="scenario-block">FILE=文件路径      导出的dmp文件
LOG=日志路径       导出日志文件
FULL=Y             全库导出
SCHEMAS=模式名     导出指定模式
TABLES=模式.表名   导出指定表（多个用逗号分隔）
QUERY="WHERE条件"  按条件导出数据
ROWS=N             仅导出结构不含数据
DIRECTORY=目录     指定输出目录
PARALLEL=4         并行导出</div>
        `
    },
    {
        id: 37, phase: 7,
        title: '达梦数据导入(dimp)',
        description: '学习使用dimp导入达梦数据库',
        tutorial: `
            <p><code>dimp</code> 是达梦的逻辑导入工具，将 dexp 导出的 .dmp 文件导入数据库。</p>
            <div class="syntax-block">dimp 用户/密码@主机:端口 FILE=文件.dmp LOG=日志.log

# 导入到同名模式
dimp SYSDBA/pass FILE=hr.dmp LOG=hr_imp.log \\
  SCHEMAS=HR

# 重映射模式（导入到不同用户）
dimp SYSDBA/pass FILE=hr.dmp LOG=hr_imp.log \\
  REMAP_SCHEMA=HR:HR_NEW

# 全库导入
dimp SYSDBA/pass FILE=full.dmp LOG=imp.log FULL=Y

# 仅导入指定表
dimp SYSDBA/pass FILE=data.dmp LOG=imp.log \\
  TABLES=HR.EMPLOYEES</div>
        `,
        win: {
            task: '请输入将 <code>hr_dm.dmp</code> 中的 <code>HR</code> 模式数据导入，并重映射到 <code>HR_BAK</code> 模式的命令（使用 <code>SYSDBA/SYSDBA001@localhost:5236</code>，日志 <code>hr_imp.log</code>）。',
            hint: 'dimp SYSDBA/SYSDBA001@localhost:5236 FILE=hr_dm.dmp LOG=hr_imp.log REMAP_SCHEMA=HR:HR_BAK',
            answer: 'dimp SYSDBA/SYSDBA001@localhost:5236 FILE=hr_dm.dmp LOG=hr_imp.log REMAP_SCHEMA=HR:HR_BAK',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^dimp\s/i.test(c), msg: '使用 dimp 命令' },
                    { pass: /SYSDBA\/SYSDBA001@localhost:5236/i.test(c), msg: '连接信息正确' },
                    { pass: /FILE\s*=\s*hr_dm\.dmp/i.test(c), msg: '导入文件为 hr_dm.dmp' },
                    { pass: /LOG\s*=\s*hr_imp\.log/i.test(c), msg: '日志文件为 hr_imp.log' },
                    { pass: /REMAP_SCHEMA\s*=\s*HR:HR_BAK/i.test(c), msg: '重映射模式 HR → HR_BAK' }
                ];
            }
        },
        linux: {
            task: '请输入将 <code>full_dm.dmp</code> 全库导入的命令（使用 <code>SYSDBA/SYSDBA001</code>，日志 <code>full_imp.log</code>）。',
            hint: 'dimp SYSDBA/SYSDBA001 FILE=full_dm.dmp LOG=full_imp.log FULL=Y',
            answer: 'dimp SYSDBA/SYSDBA001 FILE=full_dm.dmp LOG=full_imp.log FULL=Y',
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^dimp\s/i.test(c), msg: '使用 dimp 命令' },
                    { pass: /SYSDBA\/SYSDBA001/i.test(c), msg: '连接用户为 SYSDBA/SYSDBA001' },
                    { pass: /FILE\s*=\s*full_dm\.dmp/i.test(c), msg: '导入文件为 full_dm.dmp' },
                    { pass: /LOG\s*=\s*full_imp\.log/i.test(c), msg: '日志文件为 full_imp.log' },
                    { pass: /FULL\s*=\s*Y/i.test(c), msg: '使用 FULL=Y 全库导入' }
                ];
            }
        },
        context: `
            <div class="context-label">dimp 常用参数：</div>
            <div class="scenario-block">FILE=文件路径          导入的dmp文件
LOG=日志路径           导入日志
FULL=Y                 全库导入
SCHEMAS=模式名         导入指定模式
TABLES=模式.表名       导入指定表
REMAP_SCHEMA=旧:新    模式重映射
TABLE_EXISTS_ACTION=   表已存在时处理方式：
  SKIP      跳过（默认）
  APPEND    追加数据
  REPLACE   替换（先删后建）
  TRUNCATE  清空后导入
PARALLEL=4             并行导入</div>
        `
    },
    {
        id: 38, phase: 7,
        title: '达梦联机备份(DMRMAN)',
        description: '学习使用DMRMAN进行达梦物理备份与恢复',
        tutorial: `
            <p>达梦提供 <code>DMRMAN</code> 物理备份工具（类似 Oracle RMAN），以及 disql 内的 <code>BACKUP</code> 语句。</p>
            <p><span class="os-label linux">disql 内联机备份（推荐）</span></p>
            <div class="syntax-block">-- 全库联机备份
BACKUP DATABASE BACKUPSET '/backup/full_bak';

-- 增量备份（基于上次全量）
BACKUP DATABASE INCREMENT
  BACKUPSET '/backup/incr_bak';

-- 备份指定表空间
BACKUP TABLESPACE MAIN
  BACKUPSET '/backup/ts_bak';

-- 备份归档日志
BACKUP ARCHIVELOG ALL
  BACKUPSET '/backup/arch_bak';</div>
            <p><span class="os-label linux">DMRMAN 脱机恢复</span></p>
            <div class="syntax-block">dmrman
RMAN> RESTORE DATABASE '/dm_data/DAMENG/dm.ini'
  FROM BACKUPSET '/backup/full_bak';
RMAN> RECOVER DATABASE '/dm_data/DAMENG/dm.ini'
  FROM BACKUPSET '/backup/full_bak';</div>
        `,
        win: {
            task: '请在 disql 中输入对数据库做全库联机备份到 <code>/backup/full_20260211</code> 的 SQL 命令。',
            hint: "BACKUP DATABASE BACKUPSET '/backup/full_20260211';",
            answer: "BACKUP DATABASE BACKUPSET '/backup/full_20260211';",
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^BACKUP\s+DATABASE/i.test(c), msg: '使用 BACKUP DATABASE 命令' },
                    { pass: /BACKUPSET/i.test(c), msg: '指定 BACKUPSET 备份集路径' },
                    { pass: /full_20260211/i.test(c), msg: '备份路径包含 full_20260211' }
                ];
            }
        },
        linux: {
            task: '请在 disql 中输入对数据库做增量联机备份到 <code>/backup/incr_20260211</code> 的 SQL 命令。',
            hint: "BACKUP DATABASE INCREMENT BACKUPSET '/backup/incr_20260211';",
            answer: "BACKUP DATABASE INCREMENT BACKUPSET '/backup/incr_20260211';",
            validate(cmd) {
                const c = cmd.trim();
                return [
                    { pass: /^BACKUP\s+DATABASE/i.test(c), msg: '使用 BACKUP DATABASE 命令' },
                    { pass: /INCREMENT/i.test(c), msg: '使用 INCREMENT 进行增量备份' },
                    { pass: /BACKUPSET/i.test(c), msg: '指定 BACKUPSET 备份集路径' },
                    { pass: /incr_20260211/i.test(c), msg: '备份路径包含 incr_20260211' }
                ];
            }
        },
        context: `
            <div class="context-label">达梦备份恢复体系：</div>
            <div class="scenario-block">联机备份（disql内，数据库运行中）：
  BACKUP DATABASE ...       全库备份
  BACKUP DATABASE INCREMENT 增量备份
  BACKUP TABLESPACE ...     表空间备份

脱机恢复（dmrman，数据库关闭时）：
  RESTORE  → 还原物理文件
  RECOVER  → 应用归档日志前滚

dexp/dimp（逻辑备份）：
  适合跨版本、跨平台的数据迁移
  可选择性导出模式、表

备份策略建议：
  每周一次全量 + 每天增量
  定期验证备份可恢复性</div>
        `
    }
];

// ===== 状态管理 =====
const STORAGE_KEY = 'cmd-learn-progress';
let currentLevelIdx = -1;
let currentOS = 'linux';

function getProgress() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch { return {}; }
}

function saveProgress(levelId) {
    const prog = getProgress();
    const key = `${currentOS}_${levelId}`;
    prog[key] = true;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prog));
}

function isLevelCompleted(levelId) {
    const prog = getProgress();
    return !!prog[`${currentOS}_${levelId}`];
}

function isLevelUnlocked(idx) {
    if (idx === 0) return true;
    return isLevelCompleted(LEVELS[idx - 1].id);
}

function getCompletedCount() {
    return LEVELS.filter(l => isLevelCompleted(l.id)).length;
}

function goBack() {
    if (currentLevelIdx >= 0) {
        showLevelSelect();
    } else if (window.opener || document.referrer) {
        window.location.href = '../../index.html';
    } else {
        window.location.href = '../../index.html';
    }
}

// ===== 界面渲染 =====
function showLevelSelect() {
    currentLevelIdx = -1;
    document.getElementById('levelSelect').style.display = '';
    document.getElementById('levelDetail').style.display = 'none';
    document.getElementById('appInfo').style.display = '';
    renderLevelGrid();
}

function renderLevelGrid() {
    const grid = document.getElementById('levelGrid');
    const completed = getCompletedCount();

    document.getElementById('totalProgress').style.width = (completed / LEVELS.length * 100) + '%';
    document.getElementById('progressText').textContent = `已完成 ${completed} / ${LEVELS.length} 关`;

    grid.innerHTML = LEVELS.map((level, idx) => {
        const done = isLevelCompleted(level.id);
        const unlocked = isLevelUnlocked(idx);
        const phase = PHASES[level.phase - 1];
        let cls = 'level-card';
        if (done) cls += ' completed';
        if (!unlocked) cls += ' locked';
        return `
            <div class="${cls}" data-idx="${idx}">
                ${!unlocked ? '<div class="lock-icon">🔒</div>' : ''}
                <span class="phase-tag phase-${level.phase}">${phase.icon} ${phase.name}</span>
                <div class="level-number">第 ${level.id} 关</div>
                <div class="level-card-title">${level.title}</div>
                <div class="level-card-desc">${level.description}</div>
            </div>
        `;
    }).join('');

    grid.querySelectorAll('.level-card:not(.locked)').forEach(card => {
        card.addEventListener('click', () => {
            openLevel(parseInt(card.dataset.idx));
        });
    });
}

function openLevel(idx) {
    currentLevelIdx = idx;
    const level = LEVELS[idx];
    const osData = level[currentOS];

    document.getElementById('levelSelect').style.display = 'none';
    document.getElementById('levelDetail').style.display = '';
    document.getElementById('appInfo').style.display = 'none';

    document.getElementById('levelTitle').textContent = `第 ${level.id} 关：${level.title}`;
    document.getElementById('tutorialContent').innerHTML = level.tutorial;
    document.getElementById('taskContent').innerHTML = osData.task;
    document.getElementById('contextContent').innerHTML = level.context || '';

    // 终端提示符
    document.getElementById('terminalPrompt').textContent = currentOS === 'linux' ? '$' : '>';
    document.getElementById('editorTitle').textContent = currentOS === 'linux' ? '✏️ Linux 终端' : '✏️ Windows CMD';

    // 编辑器和结果重置
    document.getElementById('cmdEditor').value = '';
    document.getElementById('resultArea').innerHTML = '<p class="placeholder-text">输入命令后点击验证查看结果</p>';
    document.getElementById('hintBox').style.display = 'none';
    document.getElementById('expectedSection').style.display = 'none';

    // 导航按钮
    document.getElementById('btnPrevLevel').disabled = (idx === 0);
    const nextUnlocked = idx + 1 < LEVELS.length && isLevelUnlocked(idx + 1);
    document.getElementById('btnNextLevel').disabled = !nextUnlocked;
}

function handleRun() {
    const level = LEVELS[currentLevelIdx];
    const osData = level[currentOS];
    const cmd = document.getElementById('cmdEditor').value.trim();
    if (!cmd) return;

    const resultArea = document.getElementById('resultArea');
    const checks = osData.validate(cmd);

    const allPass = checks.every(c => c.pass);

    let html = '<ul class="check-list">';
    checks.forEach(c => {
        const cls = c.pass ? 'pass' : 'fail';
        const icon = c.pass ? '✅' : '❌';
        html += `<li class="${cls}"><span class="check-icon">${icon}</span>${c.msg}</li>`;
    });
    html += '</ul>';

    if (allPass) {
        resultArea.innerHTML = '<div class="success-msg">✅ 完全正确！所有检查点都通过了。</div>' + html;
        document.getElementById('expectedSection').style.display = 'none';
        saveProgress(level.id);
        showSuccessModal(level);
    } else {
        const passCount = checks.filter(c => c.pass).length;
        resultArea.innerHTML = `<div class="fail-msg">⚠️ 通过 ${passCount}/${checks.length} 项检查，请继续完善。</div>` + html;
        const expectedSection = document.getElementById('expectedSection');
        expectedSection.style.display = '';
        document.getElementById('expectedArea').innerHTML = `<div class="answer-block">${escapeHtml(osData.answer)}</div>`;
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showSuccessModal(level) {
    const modal = document.getElementById('successModal');
    const idx = LEVELS.indexOf(level);
    const isLast = idx === LEVELS.length - 1;

    document.getElementById('successMsg').textContent = isLast
        ? '恭喜你完成所有关卡！命令行运维技能已全面掌握！'
        : `你已掌握「${level.title}」，继续挑战下一关吧！`;

    document.getElementById('btnNextFromModal').style.display = isLast ? 'none' : '';
    modal.style.display = 'flex';
}

function handleHint() {
    const level = LEVELS[currentLevelIdx];
    const osData = level[currentOS];
    const box = document.getElementById('hintBox');
    box.textContent = osData.hint;
    box.style.display = box.style.display === 'none' ? '' : 'none';
}

function switchOS(os) {
    currentOS = os;
    document.querySelectorAll('.os-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.os === os);
    });

    // 如果在关卡中，刷新当前关卡
    if (currentLevelIdx >= 0) {
        openLevel(currentLevelIdx);
    }
    // 刷新关卡列表
    renderLevelGrid();
}

// ===== 事件绑定 =====
document.addEventListener('DOMContentLoaded', () => {
    showLevelSelect();

    document.getElementById('btnRun').addEventListener('click', handleRun);
    document.getElementById('btnHint').addEventListener('click', handleHint);

    document.getElementById('btnPrevLevel').addEventListener('click', () => {
        if (currentLevelIdx > 0) openLevel(currentLevelIdx - 1);
    });

    document.getElementById('btnNextLevel').addEventListener('click', () => {
        if (currentLevelIdx < LEVELS.length - 1 && isLevelUnlocked(currentLevelIdx + 1)) {
            openLevel(currentLevelIdx + 1);
        }
    });

    document.getElementById('btnBackToList').addEventListener('click', () => {
        document.getElementById('successModal').style.display = 'none';
        showLevelSelect();
    });

    document.getElementById('btnNextFromModal').addEventListener('click', () => {
        document.getElementById('successModal').style.display = 'none';
        if (currentLevelIdx < LEVELS.length - 1) {
            openLevel(currentLevelIdx + 1);
        }
    });

    // OS 切换
    document.querySelectorAll('.os-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            switchOS(btn.dataset.os);
        });
    });

    // Ctrl+Enter 验证
    document.getElementById('cmdEditor').addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            handleRun();
        }
    });
});
