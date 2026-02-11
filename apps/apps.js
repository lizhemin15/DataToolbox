// 应用分区配置
const appCategories = [
    { id: "all", name: "全部", icon: "📋" },
    { id: "tool", name: "效率工具", icon: "⚡" },
    { id: "learn", name: "教学", icon: "🎓" }
];

// 应用列表配置
const appsData = [
    {
        "id": "field-matcher",
        "name": "字段匹配",
        "icon": "🔀",
        "description": "智能匹配和映射数据字段",
        "keywords": ["字段", "匹配", "映射", "对应"],
        "category": "tool"
    },
    {
        "id": "data-dedup",
        "name": "数据去重",
        "icon": "🔍",
        "description": "根据指定列删除重复数据",
        "keywords": ["去重", "重复", "唯一", "清理"],
        "category": "tool"
    },
    {
        "id": "data-merge",
        "name": "数据合并",
        "icon": "📚",
        "description": "合并多个Excel文件为一个",
        "keywords": ["合并", "整合", "汇总", "联合"],
        "category": "tool"
    },
    {
        "id": "data-split",
        "name": "数据拆分",
        "icon": "✂️",
        "description": "按列值拆分数据到多个Sheet",
        "keywords": ["拆分", "分组", "分类", "划分"],
        "category": "tool"
    },
    {
        "id": "data-clean",
        "name": "数据清洗",
        "icon": "🧹",
        "description": "清理空行空列和格式问题",
        "keywords": ["清洗", "清理", "整理", "规范"],
        "category": "tool"
    },
    {
        "id": "ai-structurer",
        "name": "AI结构化",
        "icon": "🤖",
        "description": "使用AI将非结构化文本转换为JSON格式",
        "keywords": ["AI", "结构化", "JSON", "转换", "大模型"],
        "category": "tool"
    },
    {
        "id": "sql-learn",
        "name": "SQL语法学习",
        "icon": "🎓",
        "description": "闯关式游戏化学习SQL语法，从入门到进阶",
        "keywords": ["SQL", "学习", "教程", "数据库", "查询", "闯关"],
        "category": "learn"
    },
    {
        "id": "mybatis-learn",
        "name": "MyBatis语法学习",
        "icon": "🗺️",
        "description": "闯关式学习MyBatis XML Mapper语法，从基础CRUD到动态SQL",
        "keywords": ["MyBatis", "学习", "教程", "映射", "XML", "Mapper", "闯关"],
        "category": "learn"
    },
    {
        "id": "http-learn",
        "name": "网络请求教学",
        "icon": "🌐",
        "description": "闯关式学习JSON格式与Fetch API网络请求，从入门到实战",
        "keywords": ["HTTP", "网络请求", "fetch", "JSON", "API", "学习", "闯关"],
        "category": "learn"
    },
    {
        "id": "api-learn",
        "name": "信息池接口编写教学",
        "icon": "🔌",
        "description": "闯关式学习信息池API接口编写，从基础CRUD到动态SQL高级接口",
        "keywords": ["信息池", "API", "接口", "MyBatis", "SQL", "学习", "闯关", "CRUD"],
        "category": "learn"
    },
    {
        "id": "htmltool-learn",
        "name": "HTML工具开发学习",
        "icon": "🛠️",
        "description": "闯关式学习用HTML+CSS+JS开发数据处理工具，从终端创建文件到完整工具开发",
        "keywords": ["HTML", "CSS", "JavaScript", "工具", "开发", "学习", "闯关", "数据处理"],
        "category": "learn"
    },
    {
        "id": "excel-learn",
        "name": "Excel处理学习",
        "icon": "📊",
        "description": "闯关式学习用JavaScript的SheetJS库处理Excel文件，从创建工作簿到数据处理实战",
        "keywords": ["Excel", "SheetJS", "XLSX", "学习", "教程", "闯关", "数据处理", "工作簿"],
        "category": "learn"
    },
    {
        "id": "file-learn",
        "name": "JS文件处理学习",
        "icon": "📁",
        "description": "闯关式学习用JS文件处理库完成数据工作，从Blob基础到CSV/Excel/ZIP综合实战",
        "keywords": ["文件处理", "CSV", "Excel", "ZIP", "Blob", "PapaParse", "SheetJS", "JSZip", "学习", "闯关"],
        "category": "learn"
    },
    {
        "id": "word-learn",
        "name": "Word文档处理学习",
        "icon": "📝",
        "description": "闯关式学习用JavaScript的docx库生成Word文档，从创建文档到数据报告自动生成",
        "keywords": ["Word", "docx", "文档", "学习", "教程", "闯关", "报告", "表格", "自动化"],
        "category": "learn"
    },
    {
        "id": "cmd-learn",
        "name": "命令行运维学习",
        "icon": "💻",
        "description": "闯关式学习Windows和Linux命令行操作，涵盖文件管理、网络诊断、Docker、Oracle、达梦数据库等运维技能",
        "keywords": ["命令行", "CMD", "Linux", "Windows", "运维", "Docker", "网络", "数据库", "Shell", "Oracle", "达梦", "学习", "闯关"],
        "category": "learn"
    },
    {
        "id": "llm-learn",
        "name": "大模型使用教程",
        "icon": "🧠",
        "description": "闯关式学习大语言模型使用技巧，从API调用到提示词工程，再到Prompt攻防挑战",
        "keywords": ["大模型", "LLM", "AI", "提示词", "Prompt", "GPT", "学习", "闯关", "攻防"],
        "category": "learn"
    },
    {
        "id": "dsa-learn",
        "name": "数据结构与算法学习",
        "icon": "🧮",
        "description": "闯关式学习JavaScript数据结构与算法，从数组基础到树与图的进阶挑战",
        "keywords": ["数据结构", "算法", "排序", "搜索", "栈", "队列", "链表", "树", "学习", "闯关"],
        "category": "learn"
    },
    {
        "id": "ml-learn",
        "name": "机器学习算法学习",
        "icon": "🤖",
        "description": "闯关式学习用JavaScript实现机器学习与深度学习算法，从数据基础到神经网络再到数据制备实战",
        "keywords": ["机器学习", "深度学习", "ML", "神经网络", "KNN", "回归", "分类", "聚类", "学习", "闯关"],
        "category": "learn"
    },
    {
        "id": "client-learn",
        "name": "甲方的基本素养",
        "icon": "🎯",
        "description": "闯关式学习软件项目甲方核心素养，从需求表达到防坑指南，提升与AI和外协团队的协作效率",
        "keywords": ["甲方", "需求", "项目管理", "报价", "合同", "验收", "外包", "AI协作", "学习", "闯关"],
        "category": "learn"
    },
    {
        "id": "lowcode-dev",
        "name": "低代码开发",
        "icon": "🧩",
        "description": "可视化拖拽构建数据处理应用，支持Excel/Word/数据操作模块，编译为独立HTML应用",
        "keywords": ["低代码", "可视化", "拖拽", "编辑器", "编译", "应用开发"],
        "category": "tool"
    }
];
