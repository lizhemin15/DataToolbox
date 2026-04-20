/**
 * 开发者：李哲民
 */

let excelData = {};
let currentQuestions = [];
let currentIndex = 0;
let userAnswers = [];
let quizMode = '';
let similarityThreshold = 60;

function goBack() {
    window.location.href = '../../index.html';
}

// 下载示例题库
function downloadSample() {
    const workbook = XLSX.utils.book_new();

    // 单选题（包含不同数量的选项）
    const singleChoice = [
        {题干: "中国的首都是哪里？", 选项A: "上海", 选项B: "北京", 选项C: "广州", 选项D: "深圳", 答案: "B"},
        {题干: "JavaScript 是由哪家公司开发的？", 选项A: "微软", 选项B: "苹果", 选项C: "网景", 选项D: "谷歌", 答案: "C"},
        {题干: "1 + 1 等于几？", 选项A: "1", 选项B: "2", 答案: "B"}, // 只有2个选项
        {题干: "以下哪个不是 Web 前端技术？", 选项A: "HTML", 选项B: "CSS", 选项C: "Python", 选项D: "JavaScript", 答案: "C"},
        {题干: "HTTP 协议默认端口号是多少？", 选项A: "21", 选项B: "80", 选项C: "443", 答案: "B"}, // 只有3个选项
        {题干: "以下哪个是关系型数据库？", 选项A: "MongoDB", 选项B: "Redis", 选项C: "MySQL", 选项D: "Elasticsearch", 选项E: "Cassandra", 答案: "C"}, // 5个选项
        {题干: "CSS 的全称是什么？", 选项A: "Computer Style Sheets", 选项B: "Cascading Style Sheets", 选项C: "Creative Style System", 选项D: "Colorful Style Sheets", 答案: "B"},
        {题干: "以下哪种排序算法的平均时间复杂度最优？", 选项A: "冒泡排序", 选项B: "选择排序", 选项C: "快速排序", 选项D: "插入排序", 选项E: "归并排序", 选项F: "堆排序", 答案: "C"}, // 6个选项
        {题干: "Git 是一种什么工具？", 选项A: "文本编辑器", 选项B: "版本控制系统", 选项C: "数据库", 选项D: "浏览器", 答案: "B"},
        {题干: "JSON 的全称是什么？", 选项A: "JavaScript Object Notation", 选项B: "Java Standard Output Network", 选项C: "Joint Service Object Name", 选项D: "JavaScript Online Network", 答案: "A"}
    ];

    // 多选题（包含不同数量的选项）
    const multipleChoice = [
        {题干: "以下哪些是编程语言？", 选项A: "Python", 选项B: "Excel", 选项C: "JavaScript", 选项D: "Word", 答案: "A,C"},
        {题干: "选择所有偶数", 选项A: "1", 选项B: "2", 选项C: "3", 选项D: "4", 选项E: "5", 选项F: "6", 答案: "B,D,F"}, // 6个选项
        {题干: "以下哪些是前端框架？", 选项A: "React", 选项B: "Django", 选项C: "Vue", 选项D: "Spring", 答案: "A,C"},
        {题干: "HTTP 方法包括哪些？", 选项A: "GET", 选项B: "POST", 选项C: "DELETE", 答案: "A,B,C"}, // 3个选项全选
        {题干: "以下哪些是 NoSQL 数据库？", 选项A: "MongoDB", 选项B: "MySQL", 选项C: "Redis", 选项D: "PostgreSQL", 选项E: "Cassandra", 答案: "A,C,E"}, // 5个选项
        {题干: "CSS 布局方式包括哪些？", 选项A: "Flexbox", 选项B: "Grid", 选项C: "Float", 选项D: "Table", 答案: "A,B,C"},
        {题干: "以下哪些是 JavaScript 的数据类型？", 选项A: "String", 选项B: "Number", 选项C: "Boolean", 选项D: "Character", 答案: "A,B,C"},
        {题干: "Git 常用命令包括哪些？", 选项A: "commit", 选项B: "push", 选项C: "pull", 选项D: "run", 答案: "A,B,C"},
        {题干: "以下哪些是云服务提供商？", 选项A: "AWS", 选项B: "Azure", 选项C: "阿里云", 选项D: "Excel", 答案: "A,B,C"},
        {题干: "以下哪些是容器技术？", 选项A: "Docker", 选项B: "Kubernetes", 选项C: "Git", 选项D: "Podman", 答案: "A,B,D"}
    ];

    // 判断题
    const trueFalse = [
        {题干: "地球是圆的", 答案: "对"},
        {题干: "JavaScript 和 Java 是同一种语言", 答案: "错"},
        {题干: "HTML 是一种编程语言", 答案: "错"},
        {题干: "CSS 可以用来设置网页样式", 答案: "对"},
        {题干: "Python 是一种编译型语言", 答案: "错"},
        {题干: "HTTP 是一种无状态协议", 答案: "对"},
        {题干: "SQL 注入是一种网络攻击方式", 答案: "对"},
        {题干: "Git 和 GitHub 是同一个东西", 答案: "错"},
        {题干: "RESTful API 使用 HTTP 协议", 答案: "对"},
        {题干: "机器学习和人工智能是完全相同的概念", 答案: "错"}
    ];

    // 填空题
    const fillBlank = [
        {题干: "1 + 1 = ?", 答案: "2"},
        {题干: "HTML 的全称是 Hyper Text _____ Language", 答案: "Markup"},
        {题干: "CSS 中用于设置文字颜色的属性是 _____", 答案: "color"},
        {题干: "JavaScript 中声明变量使用的关键字有 var、let 和 _____", 答案: "const"},
        {题干: "HTTP 状态码 404 表示 _____", 答案: "未找到"},
        {题干: "SQL 中用于查询数据的关键字是 _____", 答案: "SELECT"},
        {题干: "Git 中用于提交代码的命令是 git _____", 答案: "commit"},
        {题干: "Python 中用于定义函数的关键字是 _____", 答案: "def"},
        {题干: "JSON 数据格式使用 _____ 和 [] 来表示对象和数组", 答案: "{}"},
        {题干: "TCP/IP 协议栈共有 _____ 层", 答案: "4"}
    ];

    // 简答题
    const essay = [
        {题干: "请简述 HTTP 协议的工作原理", 答案: "HTTP 是一种客户端-服务器协议，客户端发送请求报文到服务器，服务器返回响应报文。请求包括请求行、请求头和请求体，响应包括状态行、响应头和响应体。HTTP 是无状态协议，每次请求都是独立的。"},
        {题干: "什么是 RESTful API？它有哪些特点？", 答案: "REST 是一种软件架构风格，RESTful API 是遵循 REST 原则的 API 设计。特点包括：使用 HTTP 方法表示操作、资源通过 URL 定位、无状态通信、统一接口、支持多种数据格式如 JSON。"},
        {题干: "解释 JavaScript 中的闭包是什么", 答案: "闭包是指函数能够访问其词法作用域外的变量。当一个函数内部定义了另一个函数，内部函数可以访问外部函数的变量，即使外部函数已经执行完毕。闭包常用于数据封装和创建私有变量。"},
        {题干: "什么是 SQL 注入？如何防止？", 答案: "SQL 注入是一种代码注入攻击，攻击者通过在输入中插入恶意 SQL 代码来操纵数据库。防止方法包括：使用参数化查询、使用 ORM 框架、对输入进行验证和转义、限制数据库权限、使用 Web 应用防火墙。"},
        {题干: "简述 Git 的基本工作流程", 答案: "Git 工作流程：1) 在工作区修改文件 2) 使用 git add 将修改添加到暂存区 3) 使用 git commit 将暂存区内容提交到本地仓库 4) 使用 git push 将本地仓库推送到远程仓库 5) 使用 git pull 从远程仓库拉取更新。"},
        {题干: "什么是响应式设计？", 答案: "响应式设计是一种网页设计方法，使网页能够根据不同设备的屏幕尺寸自动调整布局和内容。主要技术包括流式布局、弹性图片、CSS 媒体查询等，目标是提供最佳的用户体验，无论用户使用什么设备访问。"},
        {题干: "解释 MVC 架构模式", 答案: "MVC 是一种软件设计模式，将应用分为三个部分：Model（模型）负责数据和业务逻辑，View（视图）负责用户界面显示，Controller（控制器）负责处理用户输入和协调模型与视图。这种分离提高了代码的可维护性和可扩展性。"},
        {题干: "什么是 Docker？它解决了什么问题？", 答案: "Docker 是一个容器化平台，允许开发者将应用及其依赖打包到轻量级容器中。它解决了环境一致性问题，确保应用在开发、测试和生产环境中行为一致。Docker 还提高了资源利用率，简化了部署流程。"},
        {题干: "解释什么是前端工程化", 答案: "前端工程化是指使用工程化的方法和工具来提高前端开发效率和质量。包括模块化开发、自动化构建、代码规范检查、单元测试、持续集成等。常用工具有 Webpack、Babel、ESLint、Jest 等，目标是提升开发体验和代码质量。"},
        {题干: "什么是微服务架构？", 答案: "微服务架构是一种将单一应用程序拆分为多个小型独立服务的架构风格。每个服务运行在独立进程中，通过轻量级通信机制（如 HTTP API）交互。优点包括独立部署、技术栈灵活、容错性好，但也增加了系统复杂度和运维难度。"}
    ];

    // 创建工作表
    const ws1 = XLSX.utils.json_to_sheet(singleChoice);
    const ws2 = XLSX.utils.json_to_sheet(multipleChoice);
    const ws3 = XLSX.utils.json_to_sheet(trueFalse);
    const ws4 = XLSX.utils.json_to_sheet(fillBlank);
    const ws5 = XLSX.utils.json_to_sheet(essay);

    // 设置列宽
    ws1['!cols'] = [{wch: 40}, {wch: 20}, {wch: 20}, {wch: 20}, {wch: 20}, {wch: 10}];
    ws2['!cols'] = [{wch: 40}, {wch: 20}, {wch: 20}, {wch: 20}, {wch: 20}, {wch: 10}];
    ws3['!cols'] = [{wch: 50}, {wch: 10}];
    ws4['!cols'] = [{wch: 50}, {wch: 20}];
    ws5['!cols'] = [{wch: 40}, {wch: 80}];

    // 添加到工作簿
    XLSX.utils.book_append_sheet(workbook, ws1, "单选题");
    XLSX.utils.book_append_sheet(workbook, ws2, "多选题");
    XLSX.utils.book_append_sheet(workbook, ws3, "判断题");
    XLSX.utils.book_append_sheet(workbook, ws4, "填空题");
    XLSX.utils.book_append_sheet(workbook, ws5, "简答题");

    // 下载文件
    XLSX.writeFile(workbook, "示例题库.xlsx");
}

// 初始化拖拽上传
document.addEventListener('DOMContentLoaded', () => {
    const uploadArea = document.getElementById('uploadArea');
    const fileInput = document.getElementById('fileInput');
    
    // 点击上传区域
    uploadArea.addEventListener('click', (e) => {
        if (e.target.closest('.upload-btn') || e.target.closest('.sample-btn')) return;
        fileInput.click();
    });
    
    // 拖拽进入
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    });
    
    // 拖拽离开
    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('dragover');
    });
    
    // 放下文件
    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFile(files[0]);
        }
    });
    
    // 文件选择
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFile(e.target.files[0]);
        }
    });
});

// 处理文件上传
function handleFile(file) {
    const fileName = file.name;
    const fileExt = fileName.split('.').pop().toLowerCase();
    
    if (!['xlsx', 'xls'].includes(fileExt)) {
        alert('请上传 .xlsx 或 .xls 格式的文件');
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, {type: 'array'});
            
            excelData = {};
            workbook.SheetNames.forEach(sheetName => {
                const sheet = workbook.Sheets[sheetName];
                excelData[sheetName] = XLSX.utils.sheet_to_json(sheet);
            });

            // 填充题型选择复选框
            const sheetCheckboxes = document.getElementById('sheetCheckboxes');
            sheetCheckboxes.innerHTML = '';
            workbook.SheetNames.forEach((name, index) => {
                const label = document.createElement('label');
                label.className = 'checkbox-label';
                
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.value = name;
                checkbox.id = `sheet_${index}`;
                checkbox.checked = true; // 默认全选
                
                const span = document.createElement('span');
                span.textContent = `${name} (${excelData[name].length} 题)`;
                
                label.appendChild(checkbox);
                label.appendChild(span);
                sheetCheckboxes.appendChild(label);
            });

            // 显示文件信息
            const fileInfo = document.getElementById('fileInfo');
            fileInfo.innerHTML = `
                <strong>文件名：</strong>${file.name}<br>
                <strong>题型数量：</strong>${workbook.SheetNames.length} 种<br>
                <strong>总题数：</strong>${Object.values(excelData).reduce((sum, arr) => sum + arr.length, 0)} 题
            `;

            document.getElementById('configSection').style.display = 'block';
        } catch (error) {
            alert('文件解析失败，请确保上传的是正确的 Excel 文件');
            console.error(error);
        }
    };
    reader.readAsArrayBuffer(file);
}

// 开始刷题
function startQuiz() {
    // 获取选中的题型
    const selectedSheets = [];
    document.querySelectorAll('#sheetCheckboxes input[type="checkbox"]:checked').forEach(cb => {
        selectedSheets.push(cb.value);
    });
    
    if (selectedSheets.length === 0) {
        alert('请至少选择一个题型！');
        return;
    }
    
    quizMode = document.getElementById('modeSelect').value;
    similarityThreshold = parseInt(document.getElementById('similarityThreshold').value);
    let count = parseInt(document.getElementById('questionCount').value);
    
    // 合并选中题型的所有题目
    let allQuestions = [];
    selectedSheets.forEach(sheetName => {
        if (excelData[sheetName] && excelData[sheetName].length > 0) {
            excelData[sheetName].forEach(q => {
                allQuestions.push({
                    ...q,
                    _sheetName: sheetName // 记录题目来源
                });
            });
        }
    });
    
    if (allQuestions.length === 0) {
        alert('选中的题型没有题目！');
        return;
    }

    if (count > allQuestions.length) {
        count = allQuestions.length;
    }

    // 随机或顺序选题
    if (quizMode === 'random') {
        currentQuestions = shuffleArray([...allQuestions]).slice(0, count);
    } else {
        currentQuestions = allQuestions.slice(0, count);
    }

    userAnswers = new Array(currentQuestions.length).fill(null);
    currentIndex = 0;

    document.getElementById('uploadSection').style.display = 'none';
    document.getElementById('quizContainer').style.display = 'block';
    
    showQuestion();
}

// 随机打乱数组
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// 显示当前题目
function showQuestion() {
    const question = currentQuestions[currentIndex];
    const questionType = detectQuestionType(question);
    
    document.getElementById('questionNumber').textContent = `第 ${currentIndex + 1} / ${currentQuestions.length} 题`;
    document.getElementById('questionType').textContent = questionType;
    document.getElementById('questionText').textContent = question['题干'] || question['问题'] || '题目内容';
    
    updateProgress();
    renderAnswerArea(question, questionType);
    
    // 显示/隐藏按钮
    document.getElementById('btnPrev').style.display = currentIndex > 0 ? 'block' : 'none';
    document.getElementById('btnNext').style.display = currentIndex < currentQuestions.length - 1 ? 'block' : 'none';
    document.getElementById('btnSubmit').style.display = currentIndex === currentQuestions.length - 1 ? 'block' : 'none';
}

// 识别题型
function detectQuestionType(question) {
    // 检查是否有选项（选项A、选项B等）
    const hasOptions = Object.keys(question).some(key => key.startsWith('选项'));
    
    if (hasOptions) {
        const answer = (question['答案'] || '').toString().toUpperCase().trim();
        // 判断是否为多选：答案中包含逗号、顿号、分号或多个字母
        if (answer.includes(',') || answer.includes('，') || 
            answer.includes(';') || answer.includes('；') || 
            answer.includes('、') || 
            (answer.length > 1 && /^[A-Z]+$/.test(answer.replace(/[,，;；、\s]/g, '')))) {
            return '多选题';
        }
        return '单选题';
    }
    
    const answerStr = (question['答案'] || '').toString().trim();
    
    // 判断题
    if (answerStr === '对' || answerStr === '错' || 
        answerStr === '正确' || answerStr === '错误' ||
        answerStr === 'true' || answerStr === 'false' ||
        answerStr === '√' || answerStr === '×' ||
        answerStr === 'T' || answerStr === 'F') {
        return '判断题';
    }
    
    // 简答题（答案较长）
    if (answerStr.length > 20) {
        return '简答题';
    }
    
    // 填空题
    return '填空题';
}

// 渲染答题区域
function renderAnswerArea(question, type) {
    const answerArea = document.getElementById('answerArea');
    answerArea.innerHTML = '';

    if (type === '单选题' || type === '多选题') {
        const options = [];
        // 获取所有选项列，按照A、B、C、D...的顺序排序
        const optionKeys = Object.keys(question)
            .filter(key => key.startsWith('选项'))
            .sort((a, b) => {
                const labelA = a.replace('选项', '');
                const labelB = b.replace('选项', '');
                return labelA.localeCompare(labelB);
            });
        
        optionKeys.forEach(key => {
            const label = key.replace('选项', '');
            const content = question[key];
            // 只添加非空选项
            if (content !== undefined && content !== null && content !== '') {
                options.push({label, content});
            }
        });

        const optionsDiv = document.createElement('div');
        optionsDiv.className = 'options';
        
        options.forEach(opt => {
            const optionDiv = document.createElement('div');
            optionDiv.className = 'option';
            
            if (type === '多选题') {
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.value = opt.label;
                checkbox.id = `opt${opt.label}`;
                
                if (userAnswers[currentIndex] && userAnswers[currentIndex].includes(opt.label)) {
                    checkbox.checked = true;
                    optionDiv.classList.add('selected');
                }
                
                checkbox.onchange = function() {
                    if (this.checked) {
                        optionDiv.classList.add('selected');
                    } else {
                        optionDiv.classList.remove('selected');
                    }
                    saveAnswer();
                };
                
                const label = document.createElement('label');
                label.htmlFor = `opt${opt.label}`;
                label.textContent = `${opt.label}. ${opt.content}`;
                
                optionDiv.appendChild(checkbox);
                optionDiv.appendChild(label);
            } else {
                const radio = document.createElement('input');
                radio.type = 'radio';
                radio.name = 'answer';
                radio.value = opt.label;
                radio.id = `opt${opt.label}`;
                
                if (userAnswers[currentIndex] === opt.label) {
                    radio.checked = true;
                    optionDiv.classList.add('selected');
                }
                
                radio.onchange = function() {
                    document.querySelectorAll('#answerArea .option').forEach(o => o.classList.remove('selected'));
                    optionDiv.classList.add('selected');
                    saveAnswer();
                };
                
                const label = document.createElement('label');
                label.htmlFor = `opt${opt.label}`;
                label.textContent = `${opt.label}. ${opt.content}`;
                
                optionDiv.appendChild(radio);
                optionDiv.appendChild(label);
            }
            
            optionsDiv.appendChild(optionDiv);
        });
        
        answerArea.appendChild(optionsDiv);
    } else if (type === '判断题') {
        const trueFalseDiv = document.createElement('div');
        trueFalseDiv.className = 'options true-false-options';
        
        ['对', '错'].forEach(value => {
            const optionDiv = document.createElement('div');
            optionDiv.className = 'option';
            
            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = 'answer';
            radio.value = value;
            radio.id = `opt${value}`;
            
            if (userAnswers[currentIndex] === value) {
                radio.checked = true;
                optionDiv.classList.add('selected');
            }
            
            radio.onchange = function() {
                document.querySelectorAll('#answerArea .option').forEach(o => o.classList.remove('selected'));
                optionDiv.classList.add('selected');
                saveAnswer();
            };
            
            const label = document.createElement('label');
            label.htmlFor = `opt${value}`;
            label.textContent = value;
            
            optionDiv.appendChild(radio);
            optionDiv.appendChild(label);
            trueFalseDiv.appendChild(optionDiv);
        });
        
        answerArea.appendChild(trueFalseDiv);
    } else {
        const textarea = document.createElement('textarea');
        textarea.className = 'answer-input';
        textarea.placeholder = type === '简答题' ? '请输入你的答案...' : '请输入答案...';
        textarea.value = userAnswers[currentIndex] || '';
        textarea.oninput = saveAnswer;
        answerArea.appendChild(textarea);
    }
}

// 保存答案
function saveAnswer() {
    const question = currentQuestions[currentIndex];
    const type = detectQuestionType(question);
    
    if (type === '多选题') {
        // 只选择答题区域内的checkbox，按字母顺序排序
        const checked = Array.from(document.querySelectorAll('#answerArea input[type="checkbox"]:checked'));
        userAnswers[currentIndex] = checked
            .map(c => c.value)
            .sort((a, b) => a.localeCompare(b))
            .join(',');
    } else if (type === '单选题' || type === '判断题') {
        const selected = document.querySelector('#answerArea input[name="answer"]:checked');
        userAnswers[currentIndex] = selected ? selected.value : null;
    } else {
        const textarea = document.querySelector('#answerArea .answer-input');
        userAnswers[currentIndex] = textarea ? textarea.value.trim() : '';
    }
}

// 更新进度条
function updateProgress() {
    const progress = ((currentIndex + 1) / currentQuestions.length) * 100;
    document.getElementById('progressFill').style.width = progress + '%';
    document.getElementById('progressText').textContent = `进度：${currentIndex + 1} / ${currentQuestions.length}`;
}

// 上一题
function prevQuestion() {
    if (currentIndex > 0) {
        currentIndex--;
        showQuestion();
    }
}

// 下一题
function nextQuestion() {
    if (currentIndex < currentQuestions.length - 1) {
        currentIndex++;
        showQuestion();
    }
}

// 文本相似度计算（综合多种算法）
function calculateTextSimilarity(text1, text2) {
    if (!text1 || !text2) return 0;
    
    text1 = text1.toLowerCase().trim();
    text2 = text2.toLowerCase().trim();
    
    if (text1 === text2) return 100;
    
    // 1. Jaccard 相似度（基于字符集合）
    const chars1 = new Set(text1.split(''));
    const chars2 = new Set(text2.split(''));
    const intersection = new Set([...chars1].filter(x => chars2.has(x)));
    const union = new Set([...chars1, ...chars2]);
    const jaccardSimilarity = (intersection.size / union.size) * 100;
    
    // 2. 余弦相似度（基于词语）
    const words1 = text1.match(/[\u4e00-\u9fa5]+|[a-z]+/gi) || [];
    const words2 = text2.match(/[\u4e00-\u9fa5]+|[a-z]+/gi) || [];
    const wordSet = new Set([...words1, ...words2]);
    const vec1 = Array.from(wordSet).map(w => words1.filter(x => x === w).length);
    const vec2 = Array.from(wordSet).map(w => words2.filter(x => x === w).length);
    const dotProduct = vec1.reduce((sum, val, i) => sum + val * vec2[i], 0);
    const mag1 = Math.sqrt(vec1.reduce((sum, val) => sum + val * val, 0));
    const mag2 = Math.sqrt(vec2.reduce((sum, val) => sum + val * val, 0));
    const cosineSimilarity = mag1 && mag2 ? (dotProduct / (mag1 * mag2)) * 100 : 0;
    
    // 3. 最长公共子序列相似度
    const lcs = (s1, s2) => {
        const dp = Array(s1.length + 1).fill(null).map(() => Array(s2.length + 1).fill(0));
        for (let i = 1; i <= s1.length; i++) {
            for (let j = 1; j <= s2.length; j++) {
                if (s1[i-1] === s2[j-1]) {
                    dp[i][j] = dp[i-1][j-1] + 1;
                } else {
                    dp[i][j] = Math.max(dp[i-1][j], dp[i][j-1]);
                }
            }
        }
        return dp[s1.length][s2.length];
    };
    const lcsLength = lcs(text1, text2);
    const lcsSimilarity = (lcsLength / Math.max(text1.length, text2.length)) * 100;
    
    // 4. 关键词匹配度
    const keywords2 = words2.filter(w => w.length >= 2);
    let keywordMatch = 0;
    keywords2.forEach(kw => {
        if (text1.includes(kw)) keywordMatch++;
    });
    const keywordSimilarity = keywords2.length > 0 ? (keywordMatch / keywords2.length) * 100 : 0;
    
    // 5. 编辑距离相似度
    const levenshtein = (s1, s2) => {
        const dp = Array(s1.length + 1).fill(null).map(() => Array(s2.length + 1).fill(0));
        for (let i = 0; i <= s1.length; i++) dp[i][0] = i;
        for (let j = 0; j <= s2.length; j++) dp[0][j] = j;
        for (let i = 1; i <= s1.length; i++) {
            for (let j = 1; j <= s2.length; j++) {
                if (s1[i-1] === s2[j-1]) {
                    dp[i][j] = dp[i-1][j-1];
                } else {
                    dp[i][j] = Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]) + 1;
                }
            }
        }
        return dp[s1.length][s2.length];
    };
    const distance = levenshtein(text1, text2);
    const editSimilarity = (1 - distance / Math.max(text1.length, text2.length)) * 100;
    
    // 综合相似度（加权平均）
    const similarity = (
        jaccardSimilarity * 0.15 +
        cosineSimilarity * 0.3 +
        lcsSimilarity * 0.2 +
        keywordSimilarity * 0.25 +
        editSimilarity * 0.1
    );
    
    return Math.round(similarity * 10) / 10;
}

// 提交答案
function submitQuiz() {
    if (!confirm('确定要提交答案吗？提交后将不能修改。')) {
        return;
    }

    let totalScore = 0;
    const results = [];

    currentQuestions.forEach((question, index) => {
        const type = detectQuestionType(question);
        const userAnswer = userAnswers[index];
        let correctAnswer = (question['答案'] || '').toString();
        let isCorrect = false;
        let similarity = null;
        let score = 0; // 当前题得分（0-1之间）

        if (type === '单选题' || type === '多选题') {
            // 标准化答案格式：去除空格、统一分隔符为逗号、转大写、排序
            const normalizeAnswer = (ans) => {
                if (!ans) return '';
                return ans.toString()
                    .toUpperCase()
                    .replace(/\s/g, '')
                    .replace(/[，；、]/g, ',')
                    .split(',')
                    .filter(x => x)
                    .sort()
                    .join(',');
            };
            
            const normalizedCorrect = normalizeAnswer(correctAnswer);
            const normalizedUser = normalizeAnswer(userAnswer);
            isCorrect = normalizedUser === normalizedCorrect;
            score = isCorrect ? 1 : 0;
            correctAnswer = normalizedCorrect; // 显示标准化后的答案
        } else if (type === '判断题') {
            const normalized = {
                '对': ['对', '正确', 'true', '√', 'T'],
                '错': ['错', '错误', 'false', '×', 'F']
            };
            
            let correctValue = '对';
            for (let key in normalized) {
                if (normalized[key].some(v => correctAnswer.toLowerCase().includes(v.toLowerCase()))) {
                    correctValue = key;
                    break;
                }
            }
            correctAnswer = correctValue;
            isCorrect = userAnswer === correctValue;
            score = isCorrect ? 1 : 0;
        } else if (type === '填空题') {
            isCorrect = (userAnswer || '').toLowerCase().trim() === correctAnswer.toLowerCase().trim();
            score = isCorrect ? 1 : 0;
        } else if (type === '简答题') {
            // 简答题：使用语义相似度判断，按比例得分
            if (userAnswer && correctAnswer) {
                similarity = calculateTextSimilarity(userAnswer, correctAnswer);
                if (similarity >= similarityThreshold) {
                    score = 1; // 满分
                    isCorrect = true;
                } else {
                    score = similarity / 100; // 按相似度比例得分
                    isCorrect = false;
                }
            } else {
                score = 0;
            }
        }

        totalScore += score;

        results.push({
            question: question['题干'] || question['问题'],
            userAnswer: userAnswer || '未作答',
            correctAnswer: correctAnswer,
            isCorrect: isCorrect,
            type: type,
            similarity: similarity,
            score: score
        });
    });

    showResults(totalScore, results);
}

// 显示结果
function showResults(totalScore, results) {
    const total = currentQuestions.length;
    const score = Math.round((totalScore / total) * 100);
    const correctCount = results.filter(r => r.isCorrect).length;
    
    document.getElementById('quizContainer').style.display = 'none';
    document.getElementById('resultContainer').style.display = 'block';

    // 设置结果图标和文字
    if (score >= 90) {
        document.getElementById('resultIcon').textContent = '🎉';
        document.getElementById('resultText').textContent = '优秀！';
    } else if (score >= 70) {
        document.getElementById('resultIcon').textContent = '👍';
        document.getElementById('resultText').textContent = '良好！';
    } else if (score >= 60) {
        document.getElementById('resultIcon').textContent = '😊';
        document.getElementById('resultText').textContent = '及格！';
    } else {
        document.getElementById('resultIcon').textContent = '💪';
        document.getElementById('resultText').textContent = '继续加油！';
    }

    document.getElementById('resultScore').textContent = score + ' 分';
    document.getElementById('totalQuestions').textContent = total;
    document.getElementById('correctCount').textContent = correctCount + ' (满分)';
    document.getElementById('wrongCount').textContent = (total - correctCount);
    document.getElementById('accuracy').textContent = `${score}% (实际得分: ${totalScore.toFixed(1)}/${total})`;

    // 显示答题详情
    const reviewContent = document.getElementById('reviewContent');
    reviewContent.innerHTML = '';
    
    results.forEach((result, index) => {
        const reviewItem = document.createElement('div');
        reviewItem.className = 'review-item';
        
        let similarityInfo = '';
        let scoreInfo = '';
        
        if (result.similarity !== null) {
            const scorePercent = Math.round(result.score * 100);
            similarityInfo = `<div class="review-answer">相似度：<span class="${result.isCorrect ? 'correct' : 'wrong'}">${result.similarity.toFixed(1)}%</span> (阈值: ${similarityThreshold}%)</div>`;
            scoreInfo = `<div class="review-answer">得分：<span class="${result.isCorrect ? 'correct' : (result.score > 0 ? 'partial' : 'wrong')}">${scorePercent}%</span></div>`;
        } else {
            const scorePercent = Math.round(result.score * 100);
            scoreInfo = `<div class="review-answer">得分：<span class="${result.isCorrect ? 'correct' : 'wrong'}">${scorePercent}%</span></div>`;
        }
        
        reviewItem.innerHTML = `
            <div class="review-question">
                ${index + 1}. [${result.type}] ${result.question}
                <span class="${result.isCorrect ? 'correct' : (result.score > 0 ? 'partial' : 'wrong')}">${result.isCorrect ? ' ✓' : (result.score > 0 ? ' ◐' : ' ✗')}</span>
            </div>
            <div class="review-answer">你的答案：<span class="${result.isCorrect ? 'correct' : (result.score > 0 ? 'partial' : 'wrong')}">${result.userAnswer}</span></div>
            <div class="review-answer">正确答案：<span class="correct">${result.correctAnswer}</span></div>
            ${similarityInfo}
            ${scoreInfo}
        `;
        reviewContent.appendChild(reviewItem);
    });
}

// 重新开始
function reset() {
    document.getElementById('resultContainer').style.display = 'none';
    document.getElementById('uploadSection').style.display = 'block';
    document.getElementById('configSection').style.display = 'none';
    document.getElementById('fileInput').value = '';
    excelData = {};
    currentQuestions = [];
    currentIndex = 0;
    userAnswers = [];
}
