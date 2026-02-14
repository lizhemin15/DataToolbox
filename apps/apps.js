// 应用分区配置
const appCategories = [
    { id: "all", name: "全部", icon: "📋" },
    { id: "tool", name: "效率工具", icon: "⚡" },
    { id: "online", name: "联机", icon: "🌐" },
    { id: "learn", name: "教学", icon: "🎓" }
];

// 标签配置
const appTags = [
    { id: "data", name: "数据处理", color: "#3b82f6" },
    { id: "ai", name: "AI", color: "#8b5cf6" },
    { id: "learn", name: "学习", color: "#10b981" },
    { id: "database", name: "数据库", color: "#f59e0b" },
    { id: "web", name: "Web开发", color: "#ec4899" },
    { id: "file", name: "文件处理", color: "#06b6d4" },
    { id: "automation", name: "自动化", color: "#84cc16" },
    { id: "office", name: "办公", color: "#f97316" },
    { id: "network", name: "网络", color: "#6366f1" },
    { id: "devops", name: "运维", color: "#14b8a6" },
    { id: "productivity", name: "效率", color: "#a855f7" },
    { id: "game", name: "游戏化", color: "#ef4444" }
];

// 应用列表配置
const appsData = [
    {
        "id": "ops-toolbox",
        "name": "运维工具箱",
        "icon": "🔧",
        "description": "集成SSH终端、SFTP文件管理和网络诊断工具，支持Ping、DNS查询、HTTP测试、端口检测、IP查询等",
        "keywords": ["运维", "SSH", "SFTP", "网络测试", "Ping", "DNS", "端口", "HTTP", "IP查询", "Whois", "SSL"],
        "category": "tool",
        "tags": ["devops", "network"]
    },
    {
        "id": "field-matcher",
        "name": "字段匹配",
        "icon": "🔀",
        "description": "智能匹配和映射数据字段",
        "keywords": ["字段", "匹配", "映射", "对应"],
        "category": "tool",
        "tags": ["data", "automation"]
    },
    {
        "id": "ai-structurer",
        "name": "AI结构化",
        "icon": "🤖",
        "description": "使用AI将非结构化文本转换为JSON格式",
        "keywords": ["AI", "结构化", "JSON", "转换", "大模型"],
        "category": "tool",
        "tags": ["ai", "data", "automation"]
    },
    {
        "id": "sql-learn",
        "name": "SQL语法学习",
        "icon": "🎓",
        "description": "闯关式游戏化学习SQL语法，从入门到进阶",
        "keywords": ["SQL", "学习", "教程", "数据库", "查询", "闯关"],
        "category": "learn",
        "tags": ["learn", "database", "game"]
    },
    {
        "id": "mybatis-learn",
        "name": "MyBatis语法学习",
        "icon": "🗺️",
        "description": "闯关式学习MyBatis XML Mapper语法，从基础CRUD到动态SQL",
        "keywords": ["MyBatis", "学习", "教程", "映射", "XML", "Mapper", "闯关"],
        "category": "learn",
        "tags": ["learn", "database", "game"]
    },
    {
        "id": "http-learn",
        "name": "网络请求教学",
        "icon": "🌐",
        "description": "闯关式学习JSON格式与Fetch API网络请求，从入门到实战",
        "keywords": ["HTTP", "网络请求", "fetch", "JSON", "API", "学习", "闯关"],
        "category": "learn",
        "tags": ["learn", "network", "web", "game"]
    },
    {
        "id": "api-learn",
        "name": "信息池接口编写教学",
        "icon": "🔌",
        "description": "闯关式学习信息池API接口编写，从基础CRUD到动态SQL高级接口",
        "keywords": ["信息池", "API", "接口", "MyBatis", "SQL", "学习", "闯关", "CRUD"],
        "category": "learn",
        "tags": ["learn", "database", "web", "game"]
    },
    {
        "id": "htmltool-learn",
        "name": "HTML工具开发学习",
        "icon": "🛠️",
        "description": "闯关式学习用HTML+CSS+JS开发数据处理工具，从终端创建文件到完整工具开发",
        "keywords": ["HTML", "CSS", "JavaScript", "工具", "开发", "学习", "闯关", "数据处理"],
        "category": "learn",
        "tags": ["learn", "web", "data", "game"]
    },
    {
        "id": "excel-learn",
        "name": "Excel处理学习",
        "icon": "📊",
        "description": "闯关式学习用JavaScript的SheetJS库处理Excel文件，从创建工作簿到数据处理实战",
        "keywords": ["Excel", "SheetJS", "XLSX", "学习", "教程", "闯关", "数据处理", "工作簿"],
        "category": "learn",
        "tags": ["learn", "file", "office", "data", "game"]
    },
    {
        "id": "file-learn",
        "name": "JS文件处理学习",
        "icon": "📁",
        "description": "闯关式学习用JS文件处理库完成数据工作，从Blob基础到CSV/Excel/ZIP综合实战",
        "keywords": ["文件处理", "CSV", "Excel", "ZIP", "Blob", "PapaParse", "SheetJS", "JSZip", "学习", "闯关"],
        "category": "learn",
        "tags": ["learn", "file", "data", "game"]
    },
    {
        "id": "word-learn",
        "name": "Word文档处理学习",
        "icon": "📝",
        "description": "闯关式学习用JavaScript的docx库生成Word文档，从创建文档到数据报告自动生成",
        "keywords": ["Word", "docx", "文档", "学习", "教程", "闯关", "报告", "表格", "自动化"],
        "category": "learn",
        "tags": ["learn", "file", "office", "automation", "game"]
    },
    {
        "id": "cmd-learn",
        "name": "命令行运维学习",
        "icon": "💻",
        "description": "闯关式学习Windows和Linux命令行操作，涵盖文件管理、网络诊断、Docker、Oracle、达梦数据库等运维技能",
        "keywords": ["命令行", "CMD", "Linux", "Windows", "运维", "Docker", "网络", "数据库", "Shell", "Oracle", "达梦", "学习", "闯关"],
        "category": "learn",
        "tags": ["learn", "devops", "database", "network", "game"]
    },
    {
        "id": "llm-learn",
        "name": "大模型使用教程",
        "icon": "🧠",
        "description": "闯关式学习大语言模型使用技巧，从API调用到提示词工程，再到Prompt攻防挑战",
        "keywords": ["大模型", "LLM", "AI", "提示词", "Prompt", "GPT", "学习", "闯关", "攻防"],
        "category": "learn",
        "tags": ["learn", "ai", "game"]
    },
    {
        "id": "dsa-learn",
        "name": "数据结构与算法学习",
        "icon": "🧮",
        "description": "闯关式学习JavaScript数据结构与算法，从数组基础到树与图的进阶挑战",
        "keywords": ["数据结构", "算法", "排序", "搜索", "栈", "队列", "链表", "树", "学习", "闯关"],
        "category": "learn",
        "tags": ["learn", "game"]
    },
    {
        "id": "ml-learn",
        "name": "机器学习算法学习",
        "icon": "🤖",
        "description": "闯关式学习用JavaScript实现机器学习与深度学习算法，从数据基础到神经网络再到数据制备实战",
        "keywords": ["机器学习", "深度学习", "ML", "神经网络", "KNN", "回归", "分类", "聚类", "学习", "闯关"],
        "category": "learn",
        "tags": ["learn", "ai", "data", "game"]
    },
    {
        "id": "client-learn",
        "name": "甲方的基本素养",
        "icon": "🎯",
        "description": "闯关式学习软件项目甲方核心素养，从需求表达到防坑指南，提升与AI和外协团队的协作效率",
        "keywords": ["甲方", "需求", "项目管理", "报价", "合同", "验收", "外包", "AI协作", "学习", "闯关"],
        "category": "learn",
        "tags": ["learn", "game"]
    },
    {
        "id": "lowcode-dev",
        "name": "低代码开发（开发完善中）",
        "icon": "🧩",
        "description": "可视化拖拽构建数据处理应用，支持Excel/Word/数据操作模块，编译为独立HTML应用",
        "keywords": ["低代码", "可视化", "拖拽", "编辑器", "编译", "应用开发"],
        "category": "tool",
        "tags": ["web", "data", "automation"]
    },
    {
        "id": "quiz-app",
        "name": "刷题练习",
        "icon": "📝",
        "description": "从Excel导入题库进行刷题练习，支持单选、多选、判断、填空、简答题型，自动批改评分",
        "keywords": ["刷题", "题库", "练习", "考试", "Excel", "单选", "多选", "判断", "填空", "简答"],
        "category": "tool",
        "tags": ["learn", "office", "productivity"]
    },
    {
        "id": "todo-pomodoro",
        "name": "待办清单+番茄钟",
        "icon": "🍅",
        "description": "美观的拖拽式待办清单与番茄钟，支持任务管理、优先级设置、专注计时和数据统计",
        "keywords": ["待办", "任务", "番茄钟", "GTD", "时间管理", "专注", "清单", "效率"],
        "category": "tool",
        "tags": ["productivity"]
    },
    {
        "id": "format-converter",
        "name": "格式万能转换",
        "icon": "🔄",
        "description": "完全离线的文件格式转换工具，支持图片格式转换、文档格式互转（Excel/CSV/JSON/TXT/PDF/Word）",
        "keywords": ["格式转换", "图片", "文档", "Excel", "CSV", "JSON", "PNG", "JPG", "PDF", "Word", "离线", "转换"],
        "category": "tool",
        "tags": ["file", "data", "office"]
    },
    {
        "id": "doc-editor",
        "name": "文档编辑器",
        "icon": "📄",
        "description": "在线编辑各类办公文档，支持Excel、Word、PPT、思维导图（JSMind/KityMinder）和Visio图表",
        "keywords": ["文档", "编辑器", "Excel", "Word", "PPT", "思维导图", "Visio", "办公", "表格", "文字处理", "演示文稿", "图表"],
        "category": "tool",
        "tags": ["office", "file", "productivity"]
    },
    {
        "id": "lan-chat",
        "name": "局域网聊天",
        "icon": "💬",
        "description": "局域网即时通讯，支持设备发现、文字消息、图片、表情、文件传输，仿微信UI设计",
        "keywords": ["聊天", "局域网", "即时通讯", "IM", "文件传输", "联机"],
        "category": "online",
        "tags": ["network"]
    }
];
