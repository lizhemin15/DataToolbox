// ===== 关卡数据 =====
const LEVELS = [
    {
        id: 1,
        title: '初识HTML文件',
        description: '学习HTML基本结构，在终端创建第一个网页文件',
        tutorial: `
            <p><strong>HTML</strong>（超文本标记语言）是网页的基础。任何 <code>.html</code> 文件都可以用浏览器打开，无需安装任何软件。</p>
            <p>一个完整的 HTML 页面由以下部分组成：</p>
            <div class="syntax-block">&lt;!DOCTYPE html&gt;        ← 声明文档类型
&lt;html&gt;                   ← 根标签
  &lt;head&gt;                  ← 头部（标题、编码等）
    &lt;meta charset="UTF-8"&gt;
    &lt;title&gt;页面标题&lt;/title&gt;
  &lt;/head&gt;
  &lt;body&gt;                  ← 主体（页面内容）
    &lt;h1&gt;大标题&lt;/h1&gt;
  &lt;/body&gt;
&lt;/html&gt;</div>
            <p><strong>如何在终端创建这个文件？</strong></p>
            <div class="terminal-group">
                <div class="terminal-block">
                    <div class="terminal-label">💻 Windows (PowerShell)</div>
                    <div class="terminal-cmd">notepad tool.html</div>
                </div>
                <div class="terminal-block">
                    <div class="terminal-label">🐧 Linux / Mac</div>
                    <div class="terminal-cmd">nano tool.html</div>
                </div>
            </div>
            <p>编辑完保存后，双击 <code>tool.html</code> 文件即可在浏览器中查看。</p>
        `,
        task: '编写一个完整的 HTML 页面：标题（title）设为 <code>数据工具</code>，页面中包含一个 <code>&lt;h1&gt;</code> 标签显示 <code>我的第一个工具</code>。',
        hint: `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>数据工具</title>
</head>
<body>
    <h1>我的第一个工具</h1>
</body>
</html>`,
        defaultCode: '',
        answerCode: `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>数据工具</title>
</head>
<body>
    <h1>我的第一个工具</h1>
</body>
</html>`,
        validate(code) {
            const checks = [];
            checks.push({ pass: /<!DOCTYPE\s+html>/i.test(code), msg: '包含 <!DOCTYPE html> 声明' });
            checks.push({ pass: /<html[\s>]/i.test(code) && /<\/html>/i.test(code), msg: '包含 <html> 标签' });
            checks.push({ pass: /<head[\s>]/i.test(code) && /<\/head>/i.test(code), msg: '包含 <head> 标签' });
            checks.push({ pass: /<title>[^<]*数据工具[^<]*<\/title>/i.test(code), msg: '<title> 设为 "数据工具"' });
            checks.push({ pass: /<body[\s>]/i.test(code) && /<\/body>/i.test(code), msg: '包含 <body> 标签' });
            checks.push({ pass: /<h1>[^<]*我的第一个工具[^<]*<\/h1>/i.test(code), msg: '<h1> 显示 "我的第一个工具"' });
            return checks;
        }
    },
    {
        id: 2,
        title: '添加CSS样式',
        description: '学习用 style 标签美化页面',
        tutorial: `
            <p><code>&lt;style&gt;</code> 标签写在 <code>&lt;head&gt;</code> 中，用于定义页面样式。</p>
            <div class="syntax-block">&lt;style&gt;
  body {
    background-color: #f0f0f0;  /* 背景色 */
    font-family: sans-serif;    /* 字体 */
  }
  h1 {
    color: blue;                /* 文字颜色 */
    text-align: center;         /* 居中 */
    font-size: 32px;            /* 字号 */
  }
&lt;/style&gt;</div>
            <p>CSS 的基本语法：<code>选择器 { 属性: 值; }</code></p>
            <p>常用选择器：</p>
            <ul style="margin:8px 0 8px 20px;line-height:2;">
                <li><code>body</code> — 选中 body 标签</li>
                <li><code>h1</code> — 选中所有 h1 标签</li>
                <li><code>.myclass</code> — 选中 class="myclass" 的元素</li>
                <li><code>#myid</code> — 选中 id="myid" 的元素</li>
            </ul>
        `,
        task: '在 <code>&lt;head&gt;</code> 中添加 <code>&lt;style&gt;</code> 标签：设置 <code>body</code> 的背景色（background），设置 <code>h1</code> 文字居中（text-align: center）并设置文字颜色（color）。',
        hint: `在 <head> 中添加：
<style>
  body { background-color: #f0f0f0; }
  h1 { text-align: center; color: #333; }
</style>`,
        defaultCode: `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>数据工具</title>
</head>
<body>
    <h1>数据处理工具</h1>
</body>
</html>`,
        answerCode: `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>数据工具</title>
    <style>
        body { background-color: #f0f0f0; }
        h1 { text-align: center; color: #333; }
    </style>
</head>
<body>
    <h1>数据处理工具</h1>
</body>
</html>`,
        validate(code) {
            const checks = [];
            checks.push({ pass: /<style[\s>]/i.test(code) && /<\/style>/i.test(code), msg: '包含 <style> 标签' });
            checks.push({ pass: /background(-color)?\s*:/i.test(code), msg: 'body 设置了背景色' });
            checks.push({ pass: /text-align\s*:\s*center/i.test(code), msg: 'h1 文字居中 (text-align: center)' });
            checks.push({ pass: /(?:^|[{;\s])color\s*:/im.test(code), msg: '设置了文字颜色 (color)' });
            return checks;
        }
    },
    {
        id: 3,
        title: 'JavaScript初体验',
        description: '学习用 script 标签操作页面元素',
        tutorial: `
            <p><code>&lt;script&gt;</code> 标签用于添加 JavaScript 代码，通常放在 <code>&lt;body&gt;</code> 的最后面。</p>
            <p>通过 JS 可以获取和修改页面上的元素：</p>
            <div class="syntax-block">// 通过 id 获取元素
var el = document.getElementById('output');

// 设置元素的文字内容
el.textContent = '新内容';

// 设置元素的 HTML 内容
el.innerHTML = '&lt;b&gt;加粗内容&lt;/b&gt;';</div>
            <p>其中 <code>getElementById</code> 通过元素的 <code>id</code> 属性来定位元素。</p>
        `,
        task: '页面已有 <code>&lt;div id="output"&gt;</code>，在 <code>&lt;script&gt;</code> 中用 <code>getElementById</code> 获取它，并将文字设置为 <code>JavaScript运行成功</code>。',
        hint: `在 </body> 前添加：
<script>
    var el = document.getElementById('output');
    el.textContent = 'JavaScript运行成功';
</script>`,
        defaultCode: `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>JS初体验</title>
    <style>
        body { font-family: sans-serif; padding: 20px; }
        #output { padding: 20px; background: #e0f7fa; border-radius: 8px; }
    </style>
</head>
<body>
    <div id="output">等待JavaScript运行...</div>

    <!-- 在下方添加 script 标签 -->

</body>
</html>`,
        answerCode: `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>JS初体验</title>
    <style>
        body { font-family: sans-serif; padding: 20px; }
        #output { padding: 20px; background: #e0f7fa; border-radius: 8px; }
    </style>
</head>
<body>
    <div id="output">等待JavaScript运行...</div>

    <script>
        var el = document.getElementById('output');
        el.textContent = 'JavaScript运行成功';
    </script>
</body>
</html>`,
        validate(code) {
            const checks = [];
            checks.push({ pass: /<script[\s>]/i.test(code) && /<\/script>/i.test(code), msg: '包含 <script> 标签' });
            checks.push({ pass: /getElementById\s*\(\s*['"]output['"]\s*\)/i.test(code), msg: '使用 getElementById 获取 #output' });
            checks.push({ pass: /textContent|innerHTML/i.test(code), msg: '使用 textContent 或 innerHTML 设置内容' });
            checks.push({ pass: /JavaScript运行成功/.test(code), msg: '内容包含 "JavaScript运行成功"' });
            return checks;
        }
    },
    {
        id: 4,
        title: '按钮点击事件',
        description: '学习创建按钮并处理点击操作',
        tutorial: `
            <p><code>&lt;button&gt;</code> 标签创建按钮，通过 <code>onclick</code> 属性绑定点击事件：</p>
            <div class="syntax-block">&lt;button onclick="handleClick()"&gt;点击我&lt;/button&gt;

&lt;script&gt;
  function handleClick() {
    // 点击后执行的代码
    document.getElementById('result').textContent = '你点击了按钮';
  }
&lt;/script&gt;</div>
            <p>也可以用 <code>addEventListener</code>：</p>
            <div class="syntax-block">document.getElementById('myBtn').addEventListener('click', function() {
    // 点击后执行的代码
});</div>
        `,
        task: '创建一个 <code>&lt;button&gt;</code> 按钮和一个 <code>&lt;div id="result"&gt;</code>，点击按钮后在 div 中显示 <code>按钮已点击</code>。',
        hint: `<button onclick="handleClick()">点击我</button>
<div id="result"></div>

<script>
    function handleClick() {
        document.getElementById('result').textContent = '按钮已点击';
    }
</script>`,
        defaultCode: `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>按钮交互</title>
    <style>
        body { font-family: sans-serif; padding: 20px; }
        button { padding: 10px 20px; font-size: 16px; cursor: pointer; }
        #result { margin-top: 20px; padding: 20px; background: #f5f5f5; border-radius: 8px; min-height: 40px; }
    </style>
</head>
<body>

    <!-- 在此添加 button 和 div#result -->

    <script>
        // 编写点击处理函数
    </script>
</body>
</html>`,
        answerCode: `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>按钮交互</title>
    <style>
        body { font-family: sans-serif; padding: 20px; }
        button { padding: 10px 20px; font-size: 16px; cursor: pointer; }
        #result { margin-top: 20px; padding: 20px; background: #f5f5f5; border-radius: 8px; min-height: 40px; }
    </style>
</head>
<body>
    <button onclick="handleClick()">点击我</button>
    <div id="result"></div>

    <script>
        function handleClick() {
            document.getElementById('result').textContent = '按钮已点击';
        }
    </script>
</body>
</html>`,
        validate(code) {
            const checks = [];
            checks.push({ pass: /<button[\s>]/i.test(code), msg: '包含 <button> 按钮' });
            checks.push({ pass: /id\s*=\s*['"]result['"]/i.test(code), msg: '包含 id="result" 的元素' });
            checks.push({ pass: /onclick|addEventListener\s*\(\s*['"]click['"]/i.test(code), msg: '绑定了点击事件' });
            checks.push({ pass: /按钮已点击/.test(code), msg: '点击后显示 "按钮已点击"' });
            return checks;
        }
    },
    {
        id: 5,
        title: '输入框与数据获取',
        description: '学习获取用户输入并处理',
        tutorial: `
            <p><code>&lt;input&gt;</code> 标签创建输入框，通过 <code>.value</code> 获取输入的值：</p>
            <div class="syntax-block">&lt;input type="text" id="nameInput" placeholder="请输入姓名"&gt;
&lt;button onclick="greet()"&gt;打招呼&lt;/button&gt;

&lt;script&gt;
  function greet() {
    var name = document.getElementById('nameInput').value;
    document.getElementById('result').textContent = '你好，' + name;
  }
&lt;/script&gt;</div>
            <p><code>.value</code> 是输入框中用户实际输入的文字内容。</p>
            <p>字符串拼接用 <code>+</code> 号连接即可。</p>
        `,
        task: '创建输入框 <code>&lt;input id="nameInput"&gt;</code> 和按钮，点击后获取输入值，在 <code>&lt;div id="result"&gt;</code> 中显示 <code>你好，XXX</code>（XXX 为输入的名字）。',
        hint: `<input type="text" id="nameInput" placeholder="请输入姓名">
<button onclick="greet()">打招呼</button>
<div id="result"></div>

<script>
    function greet() {
        var name = document.getElementById('nameInput').value;
        document.getElementById('result').textContent = '你好，' + name;
    }
</script>`,
        defaultCode: `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>输入处理</title>
    <style>
        body { font-family: sans-serif; padding: 20px; }
        input { padding: 8px 12px; font-size: 16px; margin-right: 10px; }
        button { padding: 8px 16px; font-size: 16px; cursor: pointer; }
        #result { margin-top: 20px; padding: 20px; background: #fff3e0; border-radius: 8px; }
    </style>
</head>
<body>

    <!-- 添加 input#nameInput、button 和 div#result -->

    <script>
        // 点击按钮时获取输入值，显示 "你好，XXX"
    </script>
</body>
</html>`,
        answerCode: `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>输入处理</title>
    <style>
        body { font-family: sans-serif; padding: 20px; }
        input { padding: 8px 12px; font-size: 16px; margin-right: 10px; }
        button { padding: 8px 16px; font-size: 16px; cursor: pointer; }
        #result { margin-top: 20px; padding: 20px; background: #fff3e0; border-radius: 8px; }
    </style>
</head>
<body>
    <input type="text" id="nameInput" placeholder="请输入姓名">
    <button onclick="greet()">打招呼</button>
    <div id="result"></div>

    <script>
        function greet() {
            var name = document.getElementById('nameInput').value;
            document.getElementById('result').textContent = '你好，' + name;
        }
    </script>
</body>
</html>`,
        validate(code) {
            const checks = [];
            checks.push({ pass: /<input[\s][^>]*id\s*=\s*['"]nameInput['"]/i.test(code), msg: '包含 input#nameInput 输入框' });
            checks.push({ pass: /<button[\s>]/i.test(code), msg: '包含 <button> 按钮' });
            checks.push({ pass: /id\s*=\s*['"]result['"]/i.test(code), msg: '包含 id="result" 的结果区' });
            checks.push({ pass: /\.value/i.test(code), msg: '使用 .value 获取输入值' });
            checks.push({ pass: /你好/.test(code), msg: '拼接显示 "你好，XXX"' });
            return checks;
        }
    },
    {
        id: 6,
        title: '文本分割处理',
        description: '学习用 split 分割逗号数据',
        tutorial: `
            <p>数据工作中经常需要处理逗号分隔的文本。<code>split()</code> 方法可以按指定分隔符拆分字符串为数组：</p>
            <div class="syntax-block">var text = '张三,李四,王五';
var arr = text.split(',');
// arr = ['张三', '李四', '王五']

// 用 &lt;br&gt; 连接后逐行显示
result.innerHTML = arr.join('&lt;br&gt;');</div>
            <p>常用分隔符：</p>
            <ul style="margin:8px 0 8px 20px;line-height:2;">
                <li><code>,</code> — 逗号分隔</li>
                <li><code>\\n</code> — 换行符分隔</li>
                <li><code>\\t</code> — Tab分隔</li>
                <li><code>|</code> — 竖线分隔</li>
            </ul>
        `,
        task: '用户在输入框输入逗号分隔的数据（如 <code>张三,李四,王五</code>），点击按钮后用 <code>split</code> 分割，在 <code>&lt;div id="result"&gt;</code> 中每个名字单独一行显示。',
        hint: `function processData() {
    var text = document.getElementById('dataInput').value;
    var arr = text.split(',');
    document.getElementById('result').innerHTML = arr.join('<br>');
}`,
        defaultCode: `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>文本分割</title>
    <style>
        body { font-family: sans-serif; padding: 20px; }
        input { padding: 8px 12px; font-size: 16px; width: 300px; margin-right: 10px; }
        button { padding: 8px 16px; font-size: 16px; cursor: pointer; }
        #result { margin-top: 20px; padding: 20px; background: #e8f5e9; border-radius: 8px; line-height: 2; }
    </style>
</head>
<body>
    <h2>文本分割工具</h2>
    <input type="text" id="dataInput" placeholder="输入逗号分隔的数据，如：张三,李四,王五">
    <button onclick="processData()">处理</button>
    <div id="result"></div>

    <script>
        function processData() {
            // 1. 获取输入值
            // 2. 用逗号 split 分割
            // 3. 将结果逐行显示在 #result 中
        }
    </script>
</body>
</html>`,
        answerCode: `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>文本分割</title>
    <style>
        body { font-family: sans-serif; padding: 20px; }
        input { padding: 8px 12px; font-size: 16px; width: 300px; margin-right: 10px; }
        button { padding: 8px 16px; font-size: 16px; cursor: pointer; }
        #result { margin-top: 20px; padding: 20px; background: #e8f5e9; border-radius: 8px; line-height: 2; }
    </style>
</head>
<body>
    <h2>文本分割工具</h2>
    <input type="text" id="dataInput" placeholder="输入逗号分隔的数据，如：张三,李四,王五">
    <button onclick="processData()">处理</button>
    <div id="result"></div>

    <script>
        function processData() {
            var text = document.getElementById('dataInput').value;
            var arr = text.split(',');
            document.getElementById('result').innerHTML = arr.join('<br>');
        }
    </script>
</body>
</html>`,
        validate(code) {
            const checks = [];
            checks.push({ pass: /id\s*=\s*['"]dataInput['"]/i.test(code), msg: '包含输入框 #dataInput' });
            checks.push({ pass: /<button[\s>]/i.test(code), msg: '包含处理按钮' });
            checks.push({ pass: /\.value/i.test(code), msg: '获取输入框的值 (.value)' });
            checks.push({ pass: /\.split\s*\(\s*['"],?['"]\s*\)/i.test(code), msg: '使用 split 按逗号分割' });
            checks.push({ pass: /id\s*=\s*['"]result['"]/i.test(code), msg: '包含结果区 #result' });
            checks.push({ pass: /innerHTML|join|appendChild/i.test(code), msg: '将分割结果显示到页面' });
            return checks;
        }
    },
    {
        id: 7,
        title: '动态生成表格',
        description: '学习用 JS 动态创建 HTML 表格',
        tutorial: `
            <p>HTML 表格由 <code>&lt;table&gt;</code>、<code>&lt;tr&gt;</code>（行）、<code>&lt;th&gt;</code>（表头）、<code>&lt;td&gt;</code>（单元格）组成：</p>
            <div class="syntax-block">&lt;table&gt;
  &lt;tr&gt;&lt;th&gt;姓名&lt;/th&gt;&lt;th&gt;年龄&lt;/th&gt;&lt;/tr&gt;
  &lt;tr&gt;&lt;td&gt;张三&lt;/td&gt;&lt;td&gt;28&lt;/td&gt;&lt;/tr&gt;
&lt;/table&gt;</div>
            <p>用 JS 动态生成表格的常用方法是拼接 HTML 字符串：</p>
            <div class="syntax-block">var data = [{name:'张三', age:28}, {name:'李四', age:24}];

var html = '&lt;table&gt;&lt;tr&gt;&lt;th&gt;姓名&lt;/th&gt;&lt;th&gt;年龄&lt;/th&gt;&lt;/tr&gt;';
for (var i = 0; i &lt; data.length; i++) {
    html += '&lt;tr&gt;&lt;td&gt;' + data[i].name + '&lt;/td&gt;&lt;td&gt;' + data[i].age + '&lt;/td&gt;&lt;/tr&gt;';
}
html += '&lt;/table&gt;';

document.getElementById('tableArea').innerHTML = html;</div>
        `,
        task: '页面中已有数据数组 <code>data</code>，点击按钮后在 <code>&lt;div id="tableArea"&gt;</code> 中生成包含表头（姓名、年龄、城市）和数据行的 HTML 表格。',
        hint: `function generateTable() {
    var html = '<table><tr><th>姓名</th><th>年龄</th><th>城市</th></tr>';
    for (var i = 0; i < data.length; i++) {
        html += '<tr><td>' + data[i].name + '</td><td>' + data[i].age + '</td><td>' + data[i].city + '</td></tr>';
    }
    html += '</table>';
    document.getElementById('tableArea').innerHTML = html;
}`,
        defaultCode: `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>动态表格</title>
    <style>
        body { font-family: sans-serif; padding: 20px; }
        button { padding: 8px 16px; font-size: 16px; cursor: pointer; margin-bottom: 20px; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ddd; padding: 10px; text-align: left; }
        th { background: #4CAF50; color: white; }
        tr:nth-child(even) { background: #f2f2f2; }
    </style>
</head>
<body>
    <h2>数据表格</h2>
    <button onclick="generateTable()">生成表格</button>
    <div id="tableArea"></div>

    <script>
        var data = [
            { name: '张三', age: 28, city: '北京' },
            { name: '李四', age: 24, city: '上海' },
            { name: '王五', age: 32, city: '广州' },
            { name: '赵六', age: 27, city: '深圳' }
        ];

        function generateTable() {
            // 拼接 table HTML 字符串，包含 th 表头和 td 数据
            // 设置到 #tableArea 的 innerHTML
        }
    </script>
</body>
</html>`,
        answerCode: `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>动态表格</title>
    <style>
        body { font-family: sans-serif; padding: 20px; }
        button { padding: 8px 16px; font-size: 16px; cursor: pointer; margin-bottom: 20px; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ddd; padding: 10px; text-align: left; }
        th { background: #4CAF50; color: white; }
        tr:nth-child(even) { background: #f2f2f2; }
    </style>
</head>
<body>
    <h2>数据表格</h2>
    <button onclick="generateTable()">生成表格</button>
    <div id="tableArea"></div>

    <script>
        var data = [
            { name: '张三', age: 28, city: '北京' },
            { name: '李四', age: 24, city: '上海' },
            { name: '王五', age: 32, city: '广州' },
            { name: '赵六', age: 27, city: '深圳' }
        ];

        function generateTable() {
            var html = '<table><tr><th>姓名</th><th>年龄</th><th>城市</th></tr>';
            for (var i = 0; i < data.length; i++) {
                html += '<tr><td>' + data[i].name + '</td><td>' + data[i].age + '</td><td>' + data[i].city + '</td></tr>';
            }
            html += '</table>';
            document.getElementById('tableArea').innerHTML = html;
        }
    </script>
</body>
</html>`,
        validate(code) {
            const checks = [];
            checks.push({ pass: /id\s*=\s*['"]tableArea['"]/i.test(code), msg: '包含 #tableArea 容器' });
            checks.push({ pass: /<th>|<th\s/i.test(code) || /['"]<th>/i.test(code), msg: '表格包含 <th> 表头' });
            checks.push({ pass: /<td>|<td\s/i.test(code) || /['"]<td>/i.test(code), msg: '表格包含 <td> 数据单元格' });
            checks.push({ pass: /for\s*\(|forEach|map\s*\(/i.test(code), msg: '使用循环遍历数据生成行' });
            checks.push({ pass: /innerHTML/i.test(code), msg: '使用 innerHTML 渲染表格' });
            return checks;
        }
    },
    {
        id: 8,
        title: '多行文本处理',
        description: '学习用 textarea 处理多行数据',
        tutorial: `
            <p><code>&lt;textarea&gt;</code> 可以输入多行文本。处理思路是先按换行分割行，再按逗号分割每行的字段：</p>
            <div class="syntax-block">var text = document.getElementById('textInput').value;

// 按换行分割成行数组
var lines = text.split('\\n');

// 过滤空行
lines = lines.filter(function(line) {
    return line.trim() !== '';
});

// 每行再按逗号分割
for (var i = 0; i &lt; lines.length; i++) {
    var fields = lines[i].split(',');
    // fields[0] = 姓名, fields[1] = 年龄 ...
}</div>
            <p>这是数据处理中最常用的模式：<strong>分行 → 分列 → 生成表格</strong>。</p>
        `,
        task: '用户在 <code>&lt;textarea&gt;</code> 中输入多行数据（每行格式：姓名,年龄,城市），点击按钮后按行分割、按逗号分列，生成 HTML 表格显示。',
        hint: `function parseToTable() {
    var text = document.getElementById('textInput').value;
    var lines = text.split('\\n').filter(function(l) { return l.trim() !== ''; });
    var html = '<table><tr><th>姓名</th><th>年龄</th><th>城市</th></tr>';
    for (var i = 0; i < lines.length; i++) {
        var cols = lines[i].split(',');
        html += '<tr>';
        for (var j = 0; j < cols.length; j++) {
            html += '<td>' + cols[j].trim() + '</td>';
        }
        html += '</tr>';
    }
    html += '</table>';
    document.getElementById('tableArea').innerHTML = html;
}`,
        defaultCode: `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>多行文本处理</title>
    <style>
        body { font-family: sans-serif; padding: 20px; }
        textarea { width: 100%; height: 150px; padding: 10px; font-size: 14px; font-family: monospace; }
        button { padding: 8px 16px; font-size: 16px; cursor: pointer; margin: 10px 0; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ddd; padding: 10px; text-align: left; }
        th { background: #2196F3; color: white; }
    </style>
</head>
<body>
    <h2>多行文本转表格</h2>
    <textarea id="textInput" placeholder="每行一条数据，用逗号分隔，例如：
张三,28,北京
李四,24,上海
王五,32,广州"></textarea>
    <br>
    <button onclick="parseToTable()">转换为表格</button>
    <div id="tableArea"></div>

    <script>
        function parseToTable() {
            // 1. 获取 textarea 内容
            // 2. 按换行 split('\\n') 分割成行
            // 3. 每行按逗号 split(',') 分列
            // 4. 拼接 table HTML 并显示
        }
    </script>
</body>
</html>`,
        answerCode: `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>多行文本处理</title>
    <style>
        body { font-family: sans-serif; padding: 20px; }
        textarea { width: 100%; height: 150px; padding: 10px; font-size: 14px; font-family: monospace; }
        button { padding: 8px 16px; font-size: 16px; cursor: pointer; margin: 10px 0; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ddd; padding: 10px; text-align: left; }
        th { background: #2196F3; color: white; }
    </style>
</head>
<body>
    <h2>多行文本转表格</h2>
    <textarea id="textInput" placeholder="每行一条数据，用逗号分隔，例如：
张三,28,北京
李四,24,上海
王五,32,广州"></textarea>
    <br>
    <button onclick="parseToTable()">转换为表格</button>
    <div id="tableArea"></div>

    <script>
        function parseToTable() {
            var text = document.getElementById('textInput').value;
            var lines = text.split('\\n').filter(function(l) { return l.trim() !== ''; });
            var html = '<table><tr><th>姓名</th><th>年龄</th><th>城市</th></tr>';
            for (var i = 0; i < lines.length; i++) {
                var cols = lines[i].split(',');
                html += '<tr>';
                for (var j = 0; j < cols.length; j++) {
                    html += '<td>' + cols[j].trim() + '</td>';
                }
                html += '</tr>';
            }
            html += '</table>';
            document.getElementById('tableArea').innerHTML = html;
        }
    </script>
</body>
</html>`,
        validate(code) {
            const checks = [];
            checks.push({ pass: /<textarea[\s>]/i.test(code), msg: '包含 <textarea> 输入区' });
            checks.push({ pass: /split\s*\(\s*['"]\\n['"]\s*\)/i.test(code), msg: '使用 split("\\n") 按行分割' });
            checks.push({ pass: /split\s*\(\s*['"],?['"]\s*\)/i.test(code), msg: '使用 split(",") 按逗号分列' });
            checks.push({ pass: /for\s*\(|forEach|map\s*\(/i.test(code), msg: '使用循环处理每行数据' });
            checks.push({ pass: /<table|innerHTML/i.test(code), msg: '生成表格并显示' });
            return checks;
        }
    },
    {
        id: 9,
        title: '文件读取',
        description: '学习用 FileReader 读取本地文件',
        tutorial: `
            <p><code>&lt;input type="file"&gt;</code> 创建文件选择按钮。<code>FileReader</code> API 可以读取用户选择的文件：</p>
            <div class="syntax-block">&lt;input type="file" id="fileInput"&gt;

&lt;script&gt;
document.getElementById('fileInput').addEventListener('change', function(e) {
    var file = e.target.files[0];       // 获取文件
    var reader = new FileReader();       // 创建读取器

    reader.onload = function(event) {
        var content = event.target.result; // 文件内容
        document.getElementById('content').textContent = content;
    };

    reader.readAsText(file);             // 以文本方式读取
});
&lt;/script&gt;</div>
            <p>关键步骤：获取文件 → 创建 FileReader → 设置 onload 回调 → 调用 readAsText</p>
            <p>这让你的工具可以读取用户的本地文件进行处理，<strong>数据始终在本地，不上传到任何服务器</strong>。</p>
        `,
        task: '创建 <code>&lt;input type="file" id="fileInput"&gt;</code>，用户选择文件后使用 <code>FileReader</code> 的 <code>readAsText</code> 方法读取内容，显示在 <code>&lt;div id="content"&gt;</code> 中。',
        hint: `<input type="file" id="fileInput">
<div id="content">选择文件后在此显示内容...</div>

<script>
    document.getElementById('fileInput').addEventListener('change', function(e) {
        var file = e.target.files[0];
        var reader = new FileReader();
        reader.onload = function(event) {
            document.getElementById('content').textContent = event.target.result;
        };
        reader.readAsText(file);
    });
</script>`,
        defaultCode: `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>文件读取</title>
    <style>
        body { font-family: sans-serif; padding: 20px; }
        #content { margin-top: 20px; padding: 20px; background: #f5f5f5; border-radius: 8px; white-space: pre-wrap; font-family: monospace; min-height: 100px; }
    </style>
</head>
<body>
    <h2>文件内容读取</h2>

    <!-- 添加 input type="file" -->

    <div id="content">选择文件后在此显示内容...</div>

    <script>
        // 监听文件选择事件
        // 使用 FileReader 读取文件
        // 将内容显示在 #content
    </script>
</body>
</html>`,
        answerCode: `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>文件读取</title>
    <style>
        body { font-family: sans-serif; padding: 20px; }
        #content { margin-top: 20px; padding: 20px; background: #f5f5f5; border-radius: 8px; white-space: pre-wrap; font-family: monospace; min-height: 100px; }
    </style>
</head>
<body>
    <h2>文件内容读取</h2>
    <input type="file" id="fileInput">
    <div id="content">选择文件后在此显示内容...</div>

    <script>
        document.getElementById('fileInput').addEventListener('change', function(e) {
            var file = e.target.files[0];
            var reader = new FileReader();
            reader.onload = function(event) {
                document.getElementById('content').textContent = event.target.result;
            };
            reader.readAsText(file);
        });
    </script>
</body>
</html>`,
        validate(code) {
            const checks = [];
            checks.push({ pass: /type\s*=\s*['"]file['"]/i.test(code), msg: '包含 <input type="file"> 文件选择' });
            checks.push({ pass: /FileReader/i.test(code), msg: '使用 FileReader API' });
            checks.push({ pass: /readAsText/i.test(code), msg: '调用 readAsText 读取文件' });
            checks.push({ pass: /onload|addEventListener\s*\(\s*['"]load['"]/i.test(code), msg: '设置 onload 回调处理内容' });
            checks.push({ pass: /id\s*=\s*['"]content['"]/i.test(code), msg: '将内容显示到 #content' });
            return checks;
        }
    },
    {
        id: 10,
        title: 'CSV解析与展示',
        description: '学习解析CSV数据并展示为表格',
        tutorial: `
            <p><strong>CSV</strong>（逗号分隔值）是最常见的数据交换格式。解析思路：</p>
            <div class="syntax-block">姓名,年龄,城市,职业       ← 第一行是表头
张三,28,北京,工程师         ← 后续行是数据
李四,24,上海,设计师
王五,32,广州,产品经理</div>
            <p>解析步骤：</p>
            <div class="syntax-block">var text = '...CSV内容...';
var lines = text.split('\\n').filter(l =&gt; l.trim());

// 第一行是表头
var headers = lines[0].split(',');

// 其余行是数据
var rows = [];
for (var i = 1; i &lt; lines.length; i++) {
    rows.push(lines[i].split(','));
}

// 生成表格
var html = '&lt;table&gt;&lt;tr&gt;';
headers.forEach(h =&gt; { html += '&lt;th&gt;' + h.trim() + '&lt;/th&gt;'; });
html += '&lt;/tr&gt;';
rows.forEach(row =&gt; {
    html += '&lt;tr&gt;';
    row.forEach(cell =&gt; { html += '&lt;td&gt;' + cell.trim() + '&lt;/td&gt;'; });
    html += '&lt;/tr&gt;';
});
html += '&lt;/table&gt;';</div>
        `,
        task: '用户在 textarea 中粘贴 CSV 数据（第一行为表头），点击按钮后解析：第一行作为 <code>&lt;th&gt;</code> 表头，其余行作为 <code>&lt;td&gt;</code> 数据，生成完整表格。',
        hint: `function parseCSV() {
    var text = document.getElementById('csvInput').value;
    var lines = text.split('\\n').filter(function(l) { return l.trim() !== ''; });
    if (lines.length === 0) return;
    var headers = lines[0].split(',');
    var html = '<table><tr>';
    for (var h = 0; h < headers.length; h++) {
        html += '<th>' + headers[h].trim() + '</th>';
    }
    html += '</tr>';
    for (var i = 1; i < lines.length; i++) {
        var cols = lines[i].split(',');
        html += '<tr>';
        for (var j = 0; j < cols.length; j++) {
            html += '<td>' + cols[j].trim() + '</td>';
        }
        html += '</tr>';
    }
    html += '</table>';
    document.getElementById('tableArea').innerHTML = html;
}`,
        defaultCode: `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>CSV解析</title>
    <style>
        body { font-family: sans-serif; padding: 20px; }
        textarea { width: 100%; height: 150px; padding: 10px; font-size: 14px; font-family: monospace; }
        button { padding: 8px 16px; font-size: 16px; cursor: pointer; margin: 10px 0; }
        table { border-collapse: collapse; width: 100%; margin-top: 10px; }
        th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
        th { background: #FF9800; color: white; }
        tr:hover { background: #fff3e0; }
    </style>
</head>
<body>
    <h2>CSV数据解析工具</h2>
    <textarea id="csvInput" placeholder="粘贴CSV数据，第一行为表头，例如：
姓名,年龄,城市,职业
张三,28,北京,工程师
李四,24,上海,设计师
王五,32,广州,产品经理"></textarea>
    <br>
    <button onclick="parseCSV()">解析CSV</button>
    <div id="tableArea"></div>

    <script>
        function parseCSV() {
            // 1. 获取 textarea 内容
            // 2. 按行分割，过滤空行
            // 3. 第一行 split(',') 作为表头 <th>
            // 4. 其余行 split(',') 作为数据 <td>
            // 5. 拼接 table HTML 显示
        }
    </script>
</body>
</html>`,
        answerCode: `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>CSV解析</title>
    <style>
        body { font-family: sans-serif; padding: 20px; }
        textarea { width: 100%; height: 150px; padding: 10px; font-size: 14px; font-family: monospace; }
        button { padding: 8px 16px; font-size: 16px; cursor: pointer; margin: 10px 0; }
        table { border-collapse: collapse; width: 100%; margin-top: 10px; }
        th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
        th { background: #FF9800; color: white; }
        tr:hover { background: #fff3e0; }
    </style>
</head>
<body>
    <h2>CSV数据解析工具</h2>
    <textarea id="csvInput" placeholder="粘贴CSV数据，第一行为表头">姓名,年龄,城市,职业
张三,28,北京,工程师
李四,24,上海,设计师
王五,32,广州,产品经理</textarea>
    <br>
    <button onclick="parseCSV()">解析CSV</button>
    <div id="tableArea"></div>

    <script>
        function parseCSV() {
            var text = document.getElementById('csvInput').value;
            var lines = text.split('\\n').filter(function(l) { return l.trim() !== ''; });
            if (lines.length === 0) return;
            var headers = lines[0].split(',');
            var html = '<table><tr>';
            for (var h = 0; h < headers.length; h++) {
                html += '<th>' + headers[h].trim() + '</th>';
            }
            html += '</tr>';
            for (var i = 1; i < lines.length; i++) {
                var cols = lines[i].split(',');
                html += '<tr>';
                for (var j = 0; j < cols.length; j++) {
                    html += '<td>' + cols[j].trim() + '</td>';
                }
                html += '</tr>';
            }
            html += '</table>';
            document.getElementById('tableArea').innerHTML = html;
        }
    </script>
</body>
</html>`,
        validate(code) {
            const checks = [];
            checks.push({ pass: /<textarea[\s>]/i.test(code), msg: '包含 <textarea> CSV输入区' });
            checks.push({ pass: /split\s*\(\s*['"]\\n['"]\s*\)/i.test(code), msg: '按换行分割行' });
            checks.push({ pass: /split\s*\(\s*['"],?['"]\s*\)/i.test(code), msg: '按逗号分割列' });
            checks.push({ pass: /<th|'<th|"<th/i.test(code), msg: '第一行作为 <th> 表头' });
            checks.push({ pass: /<td|'<td|"<td/i.test(code), msg: '数据行作为 <td> 单元格' });
            checks.push({ pass: /innerHTML/i.test(code), msg: '渲染表格到页面' });
            return checks;
        }
    },
    {
        id: 11,
        title: '数据过滤搜索',
        description: '学习用 filter + includes 实现关键词过滤',
        tutorial: `
            <p>在表格数据的基础上，添加搜索功能让用户可以快速筛选数据：</p>
            <div class="syntax-block">// 原始数据行
var allRows = [['张三','28','北京'], ['李四','24','上海']];

// 获取搜索关键词
var keyword = document.getElementById('searchInput').value;

// 过滤：任意一列包含关键词的行保留
var filtered = allRows.filter(function(row) {
    return row.some(function(cell) {
        return cell.includes(keyword);
    });
});</div>
            <p><code>Array.filter()</code> 返回满足条件的元素组成的新数组。</p>
            <p><code>String.includes()</code> 判断字符串是否包含指定子串。</p>
            <p><code>Array.some()</code> 判断数组中是否有至少一个元素满足条件。</p>
        `,
        task: '在 CSV 解析工具的基础上，添加搜索输入框 <code>&lt;input id="searchInput"&gt;</code>，用 <code>filter</code> 和 <code>includes</code> 实现：输入关键词后只显示包含该关键词的数据行。',
        hint: `将数据保存到全局变量后，搜索时过滤并重新渲染表格：

var allHeaders = [];
var allRows = [];

function parseCSV() {
    // ...解析后保存到 allHeaders 和 allRows...
    renderTable(allHeaders, allRows);
}

function searchData() {
    var keyword = document.getElementById('searchInput').value;
    var filtered = allRows.filter(function(row) {
        return row.some(function(cell) {
            return cell.includes(keyword);
        });
    });
    renderTable(allHeaders, filtered);
}

function renderTable(headers, rows) {
    // 生成table HTML...
}`,
        defaultCode: `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>数据过滤</title>
    <style>
        body { font-family: sans-serif; padding: 20px; }
        textarea { width: 100%; height: 120px; padding: 10px; font-size: 14px; font-family: monospace; }
        input[type="text"] { padding: 8px 12px; font-size: 14px; width: 250px; margin-right: 10px; }
        button { padding: 8px 16px; font-size: 14px; cursor: pointer; margin: 5px; }
        table { border-collapse: collapse; width: 100%; margin-top: 10px; }
        th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
        th { background: #9C27B0; color: white; }
        tr:hover { background: #f3e5f5; }
        .toolbar { margin: 10px 0; display: flex; align-items: center; gap: 10px; }
    </style>
</head>
<body>
    <h2>数据过滤工具</h2>
    <textarea id="csvInput" placeholder="粘贴CSV数据，第一行为表头">姓名,年龄,城市,职业
张三,28,北京,工程师
李四,24,上海,设计师
王五,32,广州,产品经理
赵六,27,深圳,数据分析师
孙七,30,北京,设计师</textarea>
    <div class="toolbar">
        <button onclick="parseCSV()">解析CSV</button>
        <input type="text" id="searchInput" placeholder="输入关键词搜索..." oninput="searchData()">
    </div>
    <div id="tableArea"></div>

    <script>
        var allHeaders = [];
        var allRows = [];

        function parseCSV() {
            var text = document.getElementById('csvInput').value;
            var lines = text.split('\\n').filter(function(l) { return l.trim() !== ''; });
            if (lines.length === 0) return;
            allHeaders = lines[0].split(',').map(function(h) { return h.trim(); });
            allRows = [];
            for (var i = 1; i < lines.length; i++) {
                allRows.push(lines[i].split(',').map(function(c) { return c.trim(); }));
            }
            renderTable(allHeaders, allRows);
        }

        function searchData() {
            // 获取搜索关键词
            // 用 filter + includes 过滤 allRows
            // 调用 renderTable 重新渲染
        }

        function renderTable(headers, rows) {
            var html = '<table><tr>';
            for (var h = 0; h < headers.length; h++) {
                html += '<th>' + headers[h] + '</th>';
            }
            html += '</tr>';
            for (var i = 0; i < rows.length; i++) {
                html += '<tr>';
                for (var j = 0; j < rows[i].length; j++) {
                    html += '<td>' + rows[i][j] + '</td>';
                }
                html += '</tr>';
            }
            html += '</table>';
            document.getElementById('tableArea').innerHTML = html;
        }
    </script>
</body>
</html>`,
        answerCode: `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>数据过滤</title>
    <style>
        body { font-family: sans-serif; padding: 20px; }
        textarea { width: 100%; height: 120px; padding: 10px; font-size: 14px; font-family: monospace; }
        input[type="text"] { padding: 8px 12px; font-size: 14px; width: 250px; margin-right: 10px; }
        button { padding: 8px 16px; font-size: 14px; cursor: pointer; margin: 5px; }
        table { border-collapse: collapse; width: 100%; margin-top: 10px; }
        th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
        th { background: #9C27B0; color: white; }
        tr:hover { background: #f3e5f5; }
        .toolbar { margin: 10px 0; display: flex; align-items: center; gap: 10px; }
    </style>
</head>
<body>
    <h2>数据过滤工具</h2>
    <textarea id="csvInput" placeholder="粘贴CSV数据，第一行为表头">姓名,年龄,城市,职业
张三,28,北京,工程师
李四,24,上海,设计师
王五,32,广州,产品经理
赵六,27,深圳,数据分析师
孙七,30,北京,设计师</textarea>
    <div class="toolbar">
        <button onclick="parseCSV()">解析CSV</button>
        <input type="text" id="searchInput" placeholder="输入关键词搜索..." oninput="searchData()">
    </div>
    <div id="tableArea"></div>

    <script>
        var allHeaders = [];
        var allRows = [];

        function parseCSV() {
            var text = document.getElementById('csvInput').value;
            var lines = text.split('\\n').filter(function(l) { return l.trim() !== ''; });
            if (lines.length === 0) return;
            allHeaders = lines[0].split(',').map(function(h) { return h.trim(); });
            allRows = [];
            for (var i = 1; i < lines.length; i++) {
                allRows.push(lines[i].split(',').map(function(c) { return c.trim(); }));
            }
            renderTable(allHeaders, allRows);
        }

        function searchData() {
            var keyword = document.getElementById('searchInput').value;
            if (!keyword) {
                renderTable(allHeaders, allRows);
                return;
            }
            var filtered = allRows.filter(function(row) {
                return row.some(function(cell) {
                    return cell.includes(keyword);
                });
            });
            renderTable(allHeaders, filtered);
        }

        function renderTable(headers, rows) {
            var html = '<table><tr>';
            for (var h = 0; h < headers.length; h++) {
                html += '<th>' + headers[h] + '</th>';
            }
            html += '</tr>';
            for (var i = 0; i < rows.length; i++) {
                html += '<tr>';
                for (var j = 0; j < rows[i].length; j++) {
                    html += '<td>' + rows[i][j] + '</td>';
                }
                html += '</tr>';
            }
            html += '</table>';
            document.getElementById('tableArea').innerHTML = html;
        }
    </script>
</body>
</html>`,
        validate(code) {
            const checks = [];
            checks.push({ pass: /id\s*=\s*['"]searchInput['"]/i.test(code), msg: '包含搜索输入框 #searchInput' });
            checks.push({ pass: /\.filter\s*\(/i.test(code), msg: '使用 filter 方法过滤数据' });
            checks.push({ pass: /\.includes\s*\(/i.test(code), msg: '使用 includes 匹配关键词' });
            checks.push({ pass: /\.some\s*\(/i.test(code) || /indexOf|includes/i.test(code), msg: '检查行中任意列是否匹配' });
            checks.push({ pass: /renderTable|innerHTML/i.test(code), msg: '重新渲染过滤后的表格' });
            return checks;
        }
    },
    {
        id: 12,
        title: '数据导出下载',
        description: '学习将处理后的数据导出为文件',
        tutorial: `
            <p>处理完数据后，用户需要将结果下载为文件。JS 可以通过 <code>Blob</code> 和 <code>URL.createObjectURL</code> 实现：</p>
            <div class="syntax-block">function exportCSV() {
    // 1. 准备CSV字符串
    var csvContent = '姓名,年龄,城市\\n';
    csvContent += '张三,28,北京\\n';
    csvContent += '李四,24,上海\\n';

    // 2. 创建 Blob 对象（指定UTF-8编码BOM头防止中文乱码）
    var blob = new Blob(['\\uFEFF' + csvContent], {type: 'text/csv;charset=utf-8;'});

    // 3. 生成下载链接
    var url = URL.createObjectURL(blob);

    // 4. 创建隐藏的 a 标签触发下载
    var a = document.createElement('a');
    a.href = url;
    a.download = 'data.csv';    // 指定下载文件名
    a.click();

    // 5. 释放URL
    URL.revokeObjectURL(url);
}</div>
            <p><code>\\uFEFF</code> 是 BOM 头，确保 Excel 打开 CSV 时中文不乱码。</p>
        `,
        task: '在数据工具中添加<strong>导出按钮</strong>，点击后将当前表格数据（含表头）拼成 CSV 字符串，通过 <code>Blob</code> + <code>createObjectURL</code> 导出为 <code>.csv</code> 文件下载。',
        hint: `function exportCSV() {
    if (allHeaders.length === 0) return;
    var csv = allHeaders.join(',') + '\\n';
    for (var i = 0; i < allRows.length; i++) {
        csv += allRows[i].join(',') + '\\n';
    }
    var blob = new Blob(['\\uFEFF' + csv], {type: 'text/csv;charset=utf-8;'});
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'export.csv';
    a.click();
    URL.revokeObjectURL(url);
}`,
        defaultCode: `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>数据导出工具</title>
    <style>
        body { font-family: sans-serif; padding: 20px; }
        textarea { width: 100%; height: 120px; padding: 10px; font-size: 14px; font-family: monospace; }
        button { padding: 8px 16px; font-size: 14px; cursor: pointer; margin: 5px; }
        .export-btn { background: #4CAF50; color: white; border: none; border-radius: 4px; }
        table { border-collapse: collapse; width: 100%; margin-top: 10px; }
        th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
        th { background: #2196F3; color: white; }
        .toolbar { margin: 10px 0; display: flex; align-items: center; gap: 10px; }
    </style>
</head>
<body>
    <h2>CSV数据处理与导出</h2>
    <textarea id="csvInput">姓名,年龄,城市,职业
张三,28,北京,工程师
李四,24,上海,设计师
王五,32,广州,产品经理</textarea>
    <div class="toolbar">
        <button onclick="parseCSV()">解析CSV</button>
        <button class="export-btn" onclick="exportCSV()">导出CSV</button>
    </div>
    <div id="tableArea"></div>

    <script>
        var allHeaders = [];
        var allRows = [];

        function parseCSV() {
            var text = document.getElementById('csvInput').value;
            var lines = text.split('\\n').filter(function(l) { return l.trim() !== ''; });
            if (lines.length === 0) return;
            allHeaders = lines[0].split(',').map(function(h) { return h.trim(); });
            allRows = [];
            for (var i = 1; i < lines.length; i++) {
                allRows.push(lines[i].split(',').map(function(c) { return c.trim(); }));
            }
            renderTable(allHeaders, allRows);
        }

        function exportCSV() {
            // 1. 将 allHeaders 和 allRows 拼成 CSV 字符串
            // 2. 创建 Blob 对象（加 \\uFEFF BOM头）
            // 3. 用 URL.createObjectURL 生成下载链接
            // 4. 创建 a 标签，设置 href 和 download 属性
            // 5. 触发点击下载
        }

        function renderTable(headers, rows) {
            var html = '<table><tr>';
            for (var h = 0; h < headers.length; h++) {
                html += '<th>' + headers[h] + '</th>';
            }
            html += '</tr>';
            for (var i = 0; i < rows.length; i++) {
                html += '<tr>';
                for (var j = 0; j < rows[i].length; j++) {
                    html += '<td>' + rows[i][j] + '</td>';
                }
                html += '</tr>';
            }
            html += '</table>';
            document.getElementById('tableArea').innerHTML = html;
        }
    </script>
</body>
</html>`,
        answerCode: `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>数据导出工具</title>
    <style>
        body { font-family: sans-serif; padding: 20px; }
        textarea { width: 100%; height: 120px; padding: 10px; font-size: 14px; font-family: monospace; }
        button { padding: 8px 16px; font-size: 14px; cursor: pointer; margin: 5px; }
        .export-btn { background: #4CAF50; color: white; border: none; border-radius: 4px; }
        table { border-collapse: collapse; width: 100%; margin-top: 10px; }
        th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
        th { background: #2196F3; color: white; }
        .toolbar { margin: 10px 0; display: flex; align-items: center; gap: 10px; }
    </style>
</head>
<body>
    <h2>CSV数据处理与导出</h2>
    <textarea id="csvInput">姓名,年龄,城市,职业
张三,28,北京,工程师
李四,24,上海,设计师
王五,32,广州,产品经理</textarea>
    <div class="toolbar">
        <button onclick="parseCSV()">解析CSV</button>
        <button class="export-btn" onclick="exportCSV()">导出CSV</button>
    </div>
    <div id="tableArea"></div>

    <script>
        var allHeaders = [];
        var allRows = [];

        function parseCSV() {
            var text = document.getElementById('csvInput').value;
            var lines = text.split('\\n').filter(function(l) { return l.trim() !== ''; });
            if (lines.length === 0) return;
            allHeaders = lines[0].split(',').map(function(h) { return h.trim(); });
            allRows = [];
            for (var i = 1; i < lines.length; i++) {
                allRows.push(lines[i].split(',').map(function(c) { return c.trim(); }));
            }
            renderTable(allHeaders, allRows);
        }

        function exportCSV() {
            if (allHeaders.length === 0) { alert('请先解析CSV数据'); return; }
            var csv = allHeaders.join(',') + '\\n';
            for (var i = 0; i < allRows.length; i++) {
                csv += allRows[i].join(',') + '\\n';
            }
            var blob = new Blob(['\\uFEFF' + csv], {type: 'text/csv;charset=utf-8;'});
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = 'export.csv';
            a.click();
            URL.revokeObjectURL(url);
        }

        function renderTable(headers, rows) {
            var html = '<table><tr>';
            for (var h = 0; h < headers.length; h++) {
                html += '<th>' + headers[h] + '</th>';
            }
            html += '</tr>';
            for (var i = 0; i < rows.length; i++) {
                html += '<tr>';
                for (var j = 0; j < rows[i].length; j++) {
                    html += '<td>' + rows[i][j] + '</td>';
                }
                html += '</tr>';
            }
            html += '</table>';
            document.getElementById('tableArea').innerHTML = html;
        }
    </script>
</body>
</html>`,
        validate(code) {
            const checks = [];
            checks.push({ pass: /exportCSV|export|导出/i.test(code) && /<button[\s>]/i.test(code), msg: '包含导出按钮' });
            checks.push({ pass: /\.join\s*\(\s*['"],?['"]\s*\)/i.test(code), msg: '用 join 拼接CSV行' });
            checks.push({ pass: /Blob/i.test(code), msg: '使用 Blob 创建文件对象' });
            checks.push({ pass: /createObjectURL/i.test(code), msg: '使用 createObjectURL 生成下载链接' });
            checks.push({ pass: /\.download\s*=/i.test(code), msg: '设置 download 属性指定文件名' });
            checks.push({ pass: /\.click\s*\(\s*\)/i.test(code), msg: '触发点击下载' });
            return checks;
        }
    }
];

// ===== 存储 =====
const STORAGE_KEY = 'htmltoolLearnProgress';

function getProgress() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch (e) {
        return [];
    }
}

function saveProgress(levelId) {
    const progress = getProgress();
    if (!progress.includes(levelId)) {
        progress.push(levelId);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    }
}

function isLevelUnlocked(idx) {
    if (idx === 0) return true;
    const progress = getProgress();
    return progress.includes(LEVELS[idx - 1].id);
}

// ===== 页面逻辑 =====
let currentLevelIdx = 0;

function goBack() {
    if (document.getElementById('levelDetail').style.display !== 'none') {
        showLevelSelect();
    } else {
        window.location.href = '../../index.html';
    }
}

function showLevelSelect() {
    document.getElementById('levelSelect').style.display = '';
    document.getElementById('levelDetail').style.display = 'none';
    document.getElementById('appInfo').style.display = '';

    const progress = getProgress();
    const total = LEVELS.length;
    const done = progress.length;

    document.getElementById('totalProgress').style.width = (done / total * 100) + '%';
    document.getElementById('progressText').textContent = `已完成 ${done} / ${total} 关`;

    const grid = document.getElementById('levelGrid');
    grid.innerHTML = LEVELS.map((level, idx) => {
        const unlocked = isLevelUnlocked(idx);
        const completed = progress.includes(level.id);
        let cls = 'level-card';
        if (completed) cls += ' completed';
        else if (!unlocked) cls += ' locked';

        return `
            <div class="${cls}" onclick="${unlocked ? 'openLevel(' + idx + ')' : ''}">
                ${!unlocked ? '<div class="lock-icon">🔒</div>' : ''}
                <div class="level-number">第 ${level.id} 关</div>
                <div class="level-card-title">${level.title}</div>
                <div class="level-card-desc">${level.description}</div>
            </div>
        `;
    }).join('');
}

function openLevel(idx) {
    currentLevelIdx = idx;
    const level = LEVELS[idx];

    document.getElementById('appInfo').style.display = 'none';
    document.getElementById('levelSelect').style.display = 'none';
    document.getElementById('levelDetail').style.display = '';

    document.getElementById('levelTitle').textContent = `第 ${level.id} 关：${level.title}`;
    document.getElementById('tutorialContent').innerHTML = level.tutorial;
    document.getElementById('taskContent').innerHTML = level.task;

    // 编辑器和结果重置
    document.getElementById('codeEditor').value = level.defaultCode;
    document.getElementById('previewFrame').srcdoc = '';
    document.getElementById('resultArea').innerHTML = '<p class="placeholder-text">编写代码后点击验证查看结果</p>';
    document.getElementById('hintBox').style.display = 'none';
    document.getElementById('expectedSection').style.display = 'none';

    // 导航按钮
    document.getElementById('btnPrevLevel').disabled = (idx === 0);
    const nextUnlocked = idx + 1 < LEVELS.length && isLevelUnlocked(idx + 1);
    document.getElementById('btnNextLevel').disabled = !nextUnlocked;
}

function handleRun() {
    const code = document.getElementById('codeEditor').value.trim();
    if (!code) return;

    const level = LEVELS[currentLevelIdx];

    // 更新预览
    document.getElementById('previewFrame').srcdoc = code;

    // 运行验证
    const checks = level.validate(code);
    const allPass = checks.every(c => c.pass);
    const resultArea = document.getElementById('resultArea');

    let html = '';
    if (allPass) {
        html += '<div class="success-msg">✅ 完全正确！</div>';
    } else {
        html += '<div class="fail-msg">⚠️ 部分检查未通过，请修改代码</div>';
    }

    html += '<ul class="check-list">';
    checks.forEach(c => {
        html += `<li class="${c.pass ? 'pass' : 'fail'}">
            <span class="check-icon">${c.pass ? '✅' : '❌'}</span>
            <span>${c.msg}</span>
        </li>`;
    });
    html += '</ul>';

    resultArea.innerHTML = html;

    if (allPass) {
        document.getElementById('expectedSection').style.display = 'none';
        saveProgress(level.id);
        showSuccessModal(level);
    } else {
        // 显示参考答案
        const expectedSection = document.getElementById('expectedSection');
        expectedSection.style.display = '';
        document.getElementById('expectedArea').innerHTML =
            '<div class="answer-label">参考代码：</div>' +
            '<div class="answer-block">' + escapeHtml(level.answerCode) + '</div>';
    }
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showSuccessModal(level) {
    const modal = document.getElementById('successModal');
    const idx = LEVELS.indexOf(level);
    const isLast = idx === LEVELS.length - 1;

    document.getElementById('successMsg').textContent = isLast
        ? '恭喜你完成了所有关卡！现在你可以自己创建 HTML 数据处理工具了！'
        : `你已掌握「${level.title}」，继续挑战下一关吧！`;

    document.getElementById('btnNextFromModal').style.display = isLast ? 'none' : '';
    modal.style.display = 'flex';
}

function handleHint() {
    const level = LEVELS[currentLevelIdx];
    const box = document.getElementById('hintBox');
    if (box.style.display === 'none') {
        box.textContent = level.hint;
        box.style.display = '';
    } else {
        box.style.display = 'none';
    }
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

    // Ctrl+Enter 运行
    document.getElementById('codeEditor').addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            handleRun();
        }
        // Tab 缩进支持
        if (e.key === 'Tab') {
            e.preventDefault();
            const editor = e.target;
            const start = editor.selectionStart;
            const end = editor.selectionEnd;
            editor.value = editor.value.substring(0, start) + '    ' + editor.value.substring(end);
            editor.selectionStart = editor.selectionEnd = start + 4;
        }
    });
});
