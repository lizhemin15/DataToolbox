// ===== 阶段配置 =====
const PHASES = [
    { name: '需求表达基础', icon: '📝' },
    { name: '技术认知入门', icon: '⚙️' },
    { name: '工期与成本', icon: '💰' },
    { name: '沟通与协作', icon: '🤝' },
    { name: '防坑指南', icon: '🛡️' },
    { name: 'AI协作进阶', icon: '🤖' }
];

// ===== 关卡数据 =====
const LEVELS = [
    // ==================== Phase 1: 需求表达基础 ====================
    {
        id: 1, phase: 1, type: 'choice',
        title: '好需求 vs 坏需求',
        description: '学会区分模糊需求和精确需求',
        tutorial: `
            <p>作为甲方，你说出的每一句需求都会直接影响最终产品的质量。一个<strong>好的需求</strong>应该是：</p>
            <ul>
                <li><strong>具体的</strong>：有明确的数值、范围、条件</li>
                <li><strong>可衡量的</strong>：能判断是否达标</li>
                <li><strong>可测试的</strong>：能设计测试用例验证</li>
                <li><strong>无歧义的</strong>：不同人读了理解一致</li>
            </ul>
            <div class="bad-example">❌ 坏需求："系统要快"——多快算快？1秒？5秒？10秒？</div>
            <div class="good-example">✅ 好需求："首页加载时间不超过2秒（4G网络条件下）"</div>
            <div class="bad-example">❌ 坏需求："界面要好看"——什么风格？参考谁？</div>
            <div class="good-example">✅ 好需求："采用简约风格，主色调为蓝色(#1976D2)，参考钉钉的布局"</div>
        `,
        task: '以下哪个是合格的需求描述？',
        choices: [
            'A) "系统要安全"',
            'B) "登录密码需包含大小写字母和数字，长度8-20位，连续输错5次锁定账号30分钟"',
            'C) "页面要美观大气"',
            'D) "功能要齐全"'
        ],
        correctIndex: 1,
        hint: '好的需求应该具体到可以直接编写测试用例的程度。哪个选项有明确的数值和规则？',
        answer: 'B) 这个需求包含了具体的规则（大小写+数字）、明确的范围（8-20位）、清晰的异常处理（5次锁定30分钟），开发人员可以直接据此编码和测试。其他选项都是模糊的、无法衡量的表述。'
    },
    {
        id: 2, phase: 1, type: 'choice',
        title: '功能需求 vs 非功能需求',
        description: '区分系统"做什么"和"做到什么程度"',
        tutorial: `
            <p>需求分为两大类：</p>
            <p><strong>功能需求</strong>——系统"要做什么"：</p>
            <ul>
                <li>用户可以注册、登录、修改密码</li>
                <li>管理员可以导出Excel报表</li>
                <li>系统能发送短信通知</li>
            </ul>
            <p><strong>非功能需求</strong>——系统"要做到什么程度"：</p>
            <ul>
                <li><strong>性能</strong>：响应时间 < 2秒、支持1000人并发</li>
                <li><strong>可用性</strong>：系统可用率99.9%</li>
                <li><strong>安全性</strong>：数据传输加密、密码加密存储</li>
                <li><strong>兼容性</strong>：支持Chrome/Firefox/Safari浏览器</li>
            </ul>
            <div class="key-point">甲方常犯的错误：只提功能需求，忽略非功能需求。结果系统功能做出来了，但10个人一起用就卡死了。</div>
        `,
        task: '以下哪一项属于非功能需求？',
        choices: [
            'A) 用户可以通过手机号注册账号',
            'B) 管理员可以导出Excel报表',
            'C) 系统在500人同时访问时响应时间不超过3秒',
            'D) 用户可以上传头像'
        ],
        correctIndex: 2,
        hint: '非功能需求描述的是系统的"质量属性"，而不是具体功能。哪个选项描述了性能指标？',
        answer: 'C) "500人同时访问时响应时间不超过3秒"是一个性能方面的非功能需求，描述的是系统在特定负载下的表现质量，而非具体的业务功能。'
    },
    {
        id: 3, phase: 1, type: 'text',
        title: '编写用户故事',
        description: '用标准格式精确表达一个功能需求',
        tutorial: `
            <p><strong>用户故事</strong>是一种简洁有力的需求表达方式，标准格式：</p>
            <div class="syntax-block">作为 [角色]，我希望 [功能]，以便 [价值/目的]</div>
            <p>三个要素缺一不可：</p>
            <ul>
                <li><strong>角色</strong>：谁来用这个功能</li>
                <li><strong>功能</strong>：具体要做什么</li>
                <li><strong>目的</strong>：为什么需要这个功能（最容易被忽略！）</li>
            </ul>
            <div class="good-example">✅ 作为 普通员工，我希望 通过手机App提交请假申请，以便 在外出时也能及时请假，不耽误审批流程。</div>
            <div class="bad-example">❌ "做一个请假功能"——谁用？怎么提交？为什么要这样做？全部不清楚。</div>
        `,
        task: '请为"员工查看自己的工资单"功能编写一个用户故事。需包含角色、功能和目的三个要素。',
        hint: '格式：作为 [XX角色]，我希望 [具体功能]，以便 [达到什么目的]。想想谁需要看工资单？怎么看？为什么要看？',
        answer: '参考答案：作为 公司员工，我希望 在系统中查看每月的工资明细，以便 核对工资组成是否正确、了解各项扣款情况。',
        validate(text) {
            const t = text.trim();
            return [
                { pass: /作为/.test(t), msg: '包含角色描述（"作为..."）' },
                { pass: /希望|想要|需要|能够|可以/.test(t), msg: '包含功能描述（"希望/想要/能够..."）' },
                { pass: /以便|从而|这样|目的|为了|便于/.test(t), msg: '包含目的说明（"以便/从而/为了..."）' },
                { pass: t.length >= 20, msg: '内容足够充实（不少于20字）' }
            ];
        }
    },
    {
        id: 4, phase: 1, type: 'text',
        title: '定义验收标准',
        description: '学会定义"什么算做完了"',
        tutorial: `
            <p><strong>验收标准</strong>是判断功能是否完成的具体检查点。没有验收标准，甲乙双方永远在"我觉得做完了/我觉得没做完"之间扯皮。</p>
            <p>推荐格式：</p>
            <div class="syntax-block">当 [前置条件/操作] 时，系统应 [预期行为]</div>
            <p>示例——"用户登录"功能的验收标准：</p>
            <ol>
                <li>当用户输入正确的用户名和密码时，系统应跳转到首页并显示用户昵称</li>
                <li>当用户输入错误密码时，系统应提示"用户名或密码错误"</li>
                <li>当用户连续输错5次密码时，系统应锁定账号30分钟</li>
                <li>当用户未填写必填项时，提交按钮应置灰不可点击</li>
            </ol>
            <div class="key-point">好的验收标准覆盖：正常流程 + 异常流程 + 边界情况</div>
        `,
        task: '请为"用户修改密码"功能编写至少3条验收标准，需覆盖正常情况和异常情况。',
        hint: '想想修改密码可能遇到的场景：旧密码正确/错误、新密码格式合规/不合规、新旧密码相同、确认密码不一致等。',
        answer: '参考答案：\n1. 当用户输入正确的旧密码和符合规则的新密码时，系统应提示"密码修改成功"，下次登录需使用新密码\n2. 当用户输入的旧密码错误时，系统应提示"旧密码不正确"\n3. 当新密码不满足复杂度要求时，系统应提示具体的密码规则\n4. 当两次输入的新密码不一致时，系统应提示"两次密码输入不一致"\n5. 当新密码与旧密码相同时，系统应提示"新密码不能与旧密码相同"',
        validate(text) {
            const t = text.trim();
            const lines = t.split(/\n|。|；/).filter(l => l.trim().length > 5);
            return [
                { pass: lines.length >= 3, msg: '至少编写了3条验收标准' },
                { pass: /密码/.test(t), msg: '内容与密码修改相关' },
                { pass: /正确|成功|通过/.test(t), msg: '覆盖了正常情况（成功场景）' },
                { pass: /错误|失败|不正确|不一致|不满足|不符|不能/.test(t), msg: '覆盖了异常情况（失败场景）' },
                { pass: t.length >= 50, msg: '内容足够详细（不少于50字）' }
            ];
        }
    },
    {
        id: 5, phase: 1, type: 'choice',
        title: '需求拆分',
        description: '学会把大需求拆成可交付的小单元',
        tutorial: `
            <p>大而全的需求是项目失败的温床。正确的做法是将大需求拆成<strong>小的、可独立交付、可验证</strong>的子需求。</p>
            <p>拆分原则：</p>
            <ul>
                <li><strong>按功能模块拆</strong>：用户管理、订单管理、报表管理...</li>
                <li><strong>每个子需求可独立演示</strong>：做完就能看到效果</li>
                <li><strong>粒度适中</strong>：太粗无法估时，太细管理成本高</li>
            </ul>
            <div class="good-example">✅ "用户管理"拆分：注册、登录、个人信息修改、密码管理、头像上传、账号注销</div>
            <div class="bad-example">❌ 按技术层拆分："做前端页面"、"做后端接口"——无法独立验收</div>
            <div class="bad-example">❌ 不拆分："做一个完整的用户管理"——范围不明确，无法评估进度</div>
        `,
        task: '"电商购物车"功能应该怎样拆分？以下哪个方案最合理？',
        choices: [
            'A) 购物车（一个完整的大功能，不拆分）',
            'B) 加入购物车、修改商品数量、删除商品、清空购物车、购物车列表展示、价格合计与优惠计算',
            'C) 前端页面、后端接口',
            'D) 数据库设计、UI设计'
        ],
        correctIndex: 1,
        hint: '好的拆分应该是按功能点拆，每个子项都是用户可以感知和验证的独立操作。',
        answer: 'B) 按用户可操作的功能点拆分是最佳方案。每个子需求都是用户可以实际体验和验证的独立功能，方便分步交付和验收。A不拆分无法管理进度，C和D按技术层拆分无法独立验收。'
    },

    // ==================== Phase 2: 技术认知入门 ====================
    {
        id: 6, phase: 2, type: 'choice',
        title: '前端、后端与数据库',
        description: '理解软件系统的基本组成',
        tutorial: `
            <p>现代软件系统通常由三层构成，好比一家餐厅：</p>
            <ul>
                <li><strong>前端</strong> = 服务员：负责和用户交互，展示页面、接收输入（HTML/CSS/JavaScript、Vue/React）</li>
                <li><strong>后端</strong> = 厨师：负责业务逻辑处理，处理数据、执行规则（Java/Python/Go/Node.js）</li>
                <li><strong>数据库</strong> = 仓库：负责存储和管理数据（MySQL/PostgreSQL/Oracle）</li>
            </ul>
            <div class="key-point">甲方不需要精通技术，但必须知道问题出在哪一层，才能精准描述问题、找对人解决。</div>
            <p>常见问题对应关系：</p>
            <ul>
                <li>页面样式错乱、按钮位置不对 → <strong>前端</strong>问题</li>
                <li>数据计算错误、提交后数据丢失 → <strong>后端</strong>问题</li>
                <li>查询很慢、数据不一致 → 可能是<strong>数据库</strong>问题</li>
            </ul>
        `,
        task: '以下哪个问题应该找后端开发解决？',
        choices: [
            'A) 页面上按钮的颜色需要改成红色',
            'B) 用户提交的订单数据没有保存到数据库',
            'C) 手机端页面排版错乱',
            'D) 网站Logo图片不清晰'
        ],
        correctIndex: 1,
        hint: '想想哪个问题涉及"数据处理和业务逻辑"，而不是"界面展示"。',
        answer: 'B) 订单数据没有保存涉及数据处理逻辑，属于后端问题。A是前端样式问题，C是前端响应式布局问题，D是前端资源/素材问题。'
    },
    {
        id: 7, phase: 2, type: 'choice',
        title: '数据库基础认知',
        description: '理解数据库在系统中的角色',
        tutorial: `
            <p>数据库就像一个巨大的"智能Excel"：</p>
            <ul>
                <li><strong>表（Table）</strong> = Excel的Sheet</li>
                <li><strong>行（Row）</strong> = 一条数据记录</li>
                <li><strong>列（Column）</strong> = 一个数据字段</li>
                <li><strong>主键</strong> = 每条数据的唯一身份证号</li>
                <li><strong>外键</strong> = 表与表之间的关联关系</li>
            </ul>
            <div class="key-point">数据库设计是系统的"地基"。地基设计不好，后期改造代价极大——可能需要重写大量代码。</div>
            <p>甲方需要关注：</p>
            <ul>
                <li>你的业务数据有哪些（用户、订单、商品...）</li>
                <li>数据之间有什么关系（一个用户有多个订单...）</li>
                <li>数据量级（几百条 vs 几百万条，决定技术方案）</li>
            </ul>
        `,
        task: '一个电商系统需要存储商品信息，以下哪种说法是正确的？',
        choices: [
            'A) 把所有信息放在一张表里最简单，以后改起来也方便',
            'B) 商品基本信息、商品图片、商品规格应分别建表，通过商品ID关联',
            'C) 数据库表设计不重要，后面随时可以改',
            'D) 直接用Excel存储就行，不需要数据库'
        ],
        correctIndex: 1,
        hint: '想想一个商品可能有多张图片、多种规格，如果全塞在一张表里会怎样？',
        answer: 'B) 合理的数据库设计应该将不同类型的数据分开存储并通过关联关系连接。A会导致大量数据冗余和维护困难；C错误，数据库设计后期改动代价极大；D在数据量大、多人协作时完全不可行。'
    },
    {
        id: 8, phase: 2, type: 'choice',
        title: '什么是API接口',
        description: '理解系统间通信的"桥梁"',
        tutorial: `
            <p><strong>API</strong>（应用程序编程接口）是系统之间通信的"协议"，好比银行ATM：</p>
            <ul>
                <li>你输入金额 → <strong>请求参数</strong></li>
                <li>ATM处理 → <strong>服务端逻辑</strong></li>
                <li>吐出现金+显示余额 → <strong>响应结果</strong></li>
            </ul>
            <p>一个完整的接口文档应包含：</p>
            <div class="syntax-block">接口地址：/api/user/login
请求方式：POST
请求参数：
  - username (string, 必填) 用户名
  - password (string, 必填) 密码
返回示例：
  { "code": 200, "token": "xxx", "userName": "张三" }
错误码：
  401 - 密码错误
  403 - 账号被锁定</div>
            <div class="key-point">甲方需要确认：项目交付时是否包含完整的接口文档。没有接口文档，后期维护和系统对接将非常困难。</div>
        `,
        task: '以下关于API接口的说法，哪个是正确的？',
        choices: [
            'A) 接口文档可有可无，能用就行',
            'B) 接口一旦确定就永远不能修改',
            'C) 接口设计好之后，前端和后端可以同时并行开发',
            'D) 接口只有技术人员需要关心，甲方不需要了解'
        ],
        correctIndex: 2,
        hint: '想想接口设计确定后，前端和后端各自需要做什么？它们之间还有依赖关系吗？',
        answer: 'C) 接口就像一份"契约"，双方约定好数据格式后，前端可以用模拟数据开发界面，后端可以独立开发逻辑，最后联调即可。这大大提高了开发效率。'
    },
    {
        id: 9, phase: 2, type: 'choice',
        title: '技术架构选择',
        description: '了解不同架构的适用场景',
        tutorial: `
            <p>常见的技术架构及适用场景：</p>
            <ul>
                <li><strong>单体架构</strong>：整个系统一个程序 → 小项目首选，简单快速、成本低</li>
                <li><strong>前后端分离</strong>：前端和后端独立部署 → 中型项目标配</li>
                <li><strong>微服务架构</strong>：系统拆分为多个独立服务 → 大型项目、大团队</li>
            </ul>
            <div class="key-point">杀鸡不用牛刀！小项目用微服务是过度设计，增加几倍的开发成本和运维复杂度。</div>
            <p>选择架构要考虑：</p>
            <ul>
                <li>项目规模和用户量</li>
                <li>团队技术能力和人数</li>
                <li>预算和工期</li>
                <li>未来扩展需求</li>
            </ul>
        `,
        task: '一个3人团队要开发一个内部使用的简单审批系统（用户约50人），最合适的架构是？',
        choices: [
            'A) 微服务架构，每个功能模块独立部署',
            'B) 单体架构或简单的前后端分离',
            'C) 分布式架构，使用消息队列和分布式缓存',
            'D) 云原生Serverless架构'
        ],
        correctIndex: 1,
        hint: '50人使用的内部系统，需要那么复杂的架构吗？想想团队规模和项目规模的匹配。',
        answer: 'B) 50人内部系统+3人团队，单体或前后端分离是最务实的选择。ACD都是"大炮打蚊子"，不仅增加开发成本和时间，还增加运维复杂度，3人团队也难以维护。'
    },
    {
        id: 10, phase: 2, type: 'choice',
        title: '技术债务认知',
        description: '理解"偷工减料"的长期代价',
        tutorial: `
            <p><strong>技术债务</strong>就像信用卡欠款——现在图省事走的捷径，未来要加倍偿还。</p>
            <p>常见的技术债务：</p>
            <ul>
                <li>没有代码注释和文档 → 新人接手无从下手</li>
                <li>没有自动化测试 → 改一个功能可能引发一堆Bug</li>
                <li>复制粘贴代码到处都是 → 改一个逻辑要改几十处</li>
                <li>使用过时的技术框架 → 安全漏洞和兼容问题</li>
                <li>数据库设计不合理 → 查询越来越慢</li>
            </ul>
            <div class="key-point">甲方要警惕那些为了赶工期而跳过代码审查、不写测试、不写文档的外协团队。前期省下的时间，后期要花3-5倍的代价还债。</div>
        `,
        task: '以下哪种做法会严重增加技术债务？',
        choices: [
            'A) 每次开发完成后编写自动化测试',
            'B) 赶工期时跳过代码审查，直接上线',
            'C) 定期升级依赖库版本',
            'D) 编写接口文档和代码注释'
        ],
        correctIndex: 1,
        hint: '哪个选项是在"走捷径"，跳过了重要的质量保障环节？',
        answer: 'B) 跳过代码审查直接上线是最常见的技术债务来源。没人审查的代码可能有逻辑漏洞、安全问题、性能问题，这些问题积累后会导致系统越来越难维护。ACD都是减少技术债务的好做法。'
    },

    // ==================== Phase 3: 工期与成本 ====================
    {
        id: 11, phase: 3, type: 'choice',
        title: '功能复杂度判断',
        description: '学会评估一个功能的真实开发难度',
        tutorial: `
            <p>功能复杂度主要看这几个维度：</p>
            <ul>
                <li><strong>页面数量和交互复杂度</strong>：纯展示 vs 复杂表单联动</li>
                <li><strong>业务逻辑的分支数量</strong>：规则越多越复杂</li>
                <li><strong>外部系统对接</strong>：每多对接一个系统，复杂度翻倍</li>
                <li><strong>数据处理复杂度</strong>：简单增删改查 vs 复杂统计分析</li>
                <li><strong>权限和安全要求</strong>：公开访问 vs 多级权限控制</li>
            </ul>
            <p>复杂度参考：</p>
            <div class="syntax-block">简单：静态展示页面、简单的增删改查
中等：带筛选和分页的列表、数据图表展示、文件上传下载
复杂：多级审批流程、实时消息推送、支付对接、复杂权限体系
极复杂：实时协同编辑、视频直播、AI智能推荐、大数据分析</div>
        `,
        task: '以下功能中，开发复杂度最高的是？',
        choices: [
            'A) 公司官网首页（静态展示5个板块）',
            'B) 员工通讯录（增删改查+搜索）',
            'C) 多级审批流程（可配置审批链、会签、或签、驳回、撤回、加签、转签）',
            'D) 公告管理（发布、编辑、删除、置顶）'
        ],
        correctIndex: 2,
        hint: '想想每个功能有多少种"情况"需要处理。审批流程有多少种可能的流转路径？',
        answer: 'C) 多级审批流程涉及：多种审批模式（会签/或签）、多种操作（驳回/撤回/加签/转签）、可配置的审批链、状态流转管理，逻辑分支极多，是典型的高复杂度功能。ABD的逻辑分支都相对简单。'
    },
    {
        id: 12, phase: 3, type: 'choice',
        title: '工时估算常识',
        description: '了解各类功能的合理开发时间',
        tutorial: `
            <p>一些经验参考值（纯开发时间）：</p>
            <div class="syntax-block">简单的增删改查页面：1-3天/个
复杂业务表单（带验证、联动）：3-5天/个
用户登录注册（含验证码、找回密码）：3-5天
数据导入导出（Excel/CSV）：2-5天
第三方支付对接：5-10天
审批流程引擎：5-15天
即时通讯/消息推送：10-20天
数据大屏/图表看板：5-15天</div>
            <div class="key-point">重要！以上仅是纯编码时间，实际项目工期还需要加上：<br>
• 需求确认和设计：总工时的 20-30%<br>
• 测试和修Bug：总工时的 30-40%<br>
• 联调和部署上线：总工时的 10-15%<br><br>
<strong>实际项目工期 ≈ 纯开发时间 × 2 ~ 3</strong></div>
        `,
        task: '一个包含"用户管理+权限管理+数据看板+多级审批流程"的管理系统，2人开发团队，预估多少开发周期比较合理？',
        choices: [
            'A) 1-2周',
            'B) 2-3个月',
            'C) 1年',
            'D) 3天'
        ],
        correctIndex: 1,
        hint: '先估算各模块纯开发时间，再乘以2-3倍得到实际工期。2人团队的产能有限。',
        answer: 'B) 粗算：用户管理(5天)+权限管理(5-8天)+数据看板(8-12天)+审批流程(10-15天)，纯开发约30-40天。加上设计、测试、联调，实际工期约60-90天。2人团队并行开发，大约需要2-3个月。A和D严重低估，C过度高估。'
    },
    {
        id: 13, phase: 3, type: 'choice',
        title: '需求变更的真实成本',
        description: '理解"改一下"背后的真实代价',
        tutorial: `
            <p>需求变更的成本随项目阶段<strong>指数增长</strong>：</p>
            <div class="syntax-block">需求阶段改：成本 × 1    （改一句话的事）
设计阶段改：成本 × 3    （要重新设计）
开发阶段改：成本 × 5-10 （要改代码+重新测试）
测试阶段改：成本 × 10-20（要改代码+全面回归测试）
上线后改：  成本 × 50-100（改代码+测试+数据迁移+停机部署）</div>
            <p>一个"简单"变更的实际工作量：</p>
            <div class="syntax-block">需求分析(0.5天) + 方案设计(0.5天) + 编码(1-3天)
+ 自测(0.5天) + 联调(0.5天) + 回归测试(0.5-1天)
= 3-6天</div>
            <div class="key-point">甲方口中的"就改一下"，在开发眼里可能是"牵一发动全身"。</div>
        `,
        task: '项目开发到一半时，甲方提出"把密码登录改成手机验证码登录"，以下对这个变更的评估，哪个最准确？',
        choices: [
            'A) 很简单，就改一下登录框，半天搞定',
            'B) 需要3-5个工作日：改前端登录页、改后端登录逻辑、对接短信服务商、处理验证码发送和校验、测试所有登录相关流程',
            'C) 需要重新开发整个系统',
            'D) 不可能实现'
        ],
        correctIndex: 1,
        hint: '想想从"密码登录"改成"验证码登录"需要改动哪些环节：界面、后端逻辑、短信服务对接、安全防护...',
        answer: 'B) 这个变更涉及：前端改登录界面和交互逻辑、后端改登录认证流程、对接短信服务商API、实现验证码生成-发送-校验-过期机制、防刷攻击、全面测试。看似"简单改一下"，实际是一个完整的功能开发。'
    },
    {
        id: 14, phase: 3, type: 'choice',
        title: '合理报价判断',
        description: '掌握判断软件开发报价是否合理的方法',
        tutorial: `
            <p>软件开发报价的核心是<strong>人力成本</strong>：</p>
            <div class="syntax-block">初级开发者：500-800元/人天
中级开发者：800-1500元/人天
高级开发者：1500-3000元/人天
项目经理：  1000-2000元/人天
UI设计师：  600-1500元/人天</div>
            <p>报价公式：</p>
            <div class="syntax-block">项目报价 = 团队日薪总和 × 工期天数 × (1 + 利润率)
利润率通常在 20-40%</div>
            <div class="key-point">报价过低的风险：<br>
• 使用实习生/低水平开发者 → 质量差、Bug多<br>
• 中途要求加钱 → 做到一半就"涨价"<br>
• 偷工减料 → 不写测试、不写文档、不做安全防护<br>
• 半途而废 → 收了钱跑路</div>
        `,
        task: '一个需要3个月、3人团队开发的中型管理系统，以下哪个报价范围最可能是靠谱的？',
        choices: [
            'A) 5,000元',
            'B) 15-25万元',
            'C) 500万元',
            'D) 8,000元'
        ],
        correctIndex: 1,
        hint: '3人×3个月×22个工作日×平均人天单价 = ？再加上适当的利润和管理成本。',
        answer: 'B) 计算：3人×3月×22天=198人天。按中级开发者平均1000元/人天计算，纯人力约20万。加上管理成本和利润，15-25万是合理范围。A和D明显过低，大概率是诈骗或极低质量；C则远远高估。'
    },
    {
        id: 15, phase: 3, type: 'choice',
        title: '隐藏成本识别',
        description: '发现甲方最容易忽略的持续性开支',
        tutorial: `
            <p>很多甲方以为开发完就结束了，但其实系统上线后还有大量<strong>持续性成本</strong>：</p>
            <ul>
                <li><strong>服务器/云服务费</strong>：每年几千到几万元</li>
                <li><strong>域名和SSL证书</strong>：每年几百到几千元</li>
                <li><strong>第三方API费用</strong>：短信（0.04-0.06元/条）、OCR识别、地图API等按量计费</li>
                <li><strong>数据备份和安全防护</strong>：存储空间、防火墙等</li>
                <li><strong>运维监控</strong>：日志、报警、性能监控</li>
                <li><strong>Bug修复和功能优化</strong>：质保期后按时计费</li>
                <li><strong>技术升级</strong>：安全补丁、系统版本升级</li>
            </ul>
            <div class="key-point">总拥有成本(TCO) = 开发成本 + 每年运维成本 × 使用年限</div>
        `,
        task: '一个系统开发费20万，每年运维费3万，计划使用5年，总拥有成本是多少？',
        choices: [
            'A) 20万',
            'B) 23万',
            'C) 35万',
            'D) 15万'
        ],
        correctIndex: 2,
        hint: 'TCO = 开发成本 + 运维成本 × 年数。代入数字算一算。',
        answer: 'C) TCO = 20万(开发) + 3万×5年(运维) = 35万。这意味着5年的总投入比初始开发成本高出75%。甲方在做预算时必须考虑长期运维成本，而不是只看开发报价。'
    },

    // ==================== Phase 4: 沟通与协作 ====================
    {
        id: 16, phase: 4, type: 'text',
        title: '编写需求简报',
        description: '学会用一页纸讲清楚你要做什么',
        tutorial: `
            <p>一个合格的<strong>需求简报</strong>是项目启动的起点，应包含：</p>
            <ol>
                <li><strong>项目背景</strong>：为什么要做这个系统？解决什么问题？</li>
                <li><strong>目标用户</strong>：谁来用？有哪几类角色？</li>
                <li><strong>核心功能</strong>：最重要的功能有哪些？（不要面面俱到）</li>
                <li><strong>参考产品</strong>：类似哪个产品？可提供截图或链接</li>
                <li><strong>技术要求</strong>：有无特殊限制（如必须兼容IE、需要部署在内网等）</li>
                <li><strong>时间和预算</strong>：什么时候要用？预算范围多少？</li>
            </ol>
            <div class="key-point">需求简报不需要写得像合同一样复杂，关键是让开发方快速理解"你到底想做什么"。一页纸说清楚最好。</div>
        `,
        task: '请为"公司内部报销系统"编写一段需求简报摘要，至少包含：项目背景、目标用户（至少2种角色）、核心功能（至少3个）。',
        hint: '想想：为什么需要报销系统？谁会用这个系统（提交报销的员工？审批的领导？财务人员？）核心功能有哪些（提交报销单、审批、查看报销记录...）？',
        answer: '参考答案：\n项目背景：目前公司员工报销流程全靠纸质单据和邮件，效率低、易丢失、难追踪，需要开发线上报销系统提升效率。\n目标用户：普通员工（提交报销）、部门主管（审批报销）、财务人员（审核打款）。\n核心功能：1.员工在线填写报销单并上传发票照片 2.多级审批流程（部门主管→财务审核）3.报销进度实时查看 4.财务报表统计和导出。',
        validate(text) {
            const t = text.trim();
            return [
                { pass: /背景|原因|目的|为什么|现状|问题/.test(t), msg: '包含项目背景说明' },
                { pass: /员工|用户|管理员|主管|领导|财务/.test(t), msg: '提到了目标用户角色' },
                { pass: (t.match(/报销|审批|提交|查看|统计|发票|审核|打款|记录|流程/g) || []).length >= 3, msg: '描述了至少3个核心功能点' },
                { pass: t.length >= 60, msg: '内容足够充实（不少于60字）' }
            ];
        }
    },
    {
        id: 17, phase: 4, type: 'text',
        title: '如何描述Bug',
        description: '学会写让开发秒懂的Bug报告',
        tutorial: `
            <p>一个好的Bug报告就像"犯罪现场报告"，必须包含：</p>
            <ol>
                <li><strong>操作步骤</strong>：第1步做什么，第2步做什么...（可复现）</li>
                <li><strong>预期结果</strong>：按照设计应该发生什么</li>
                <li><strong>实际结果</strong>：实际发生了什么</li>
                <li><strong>环境信息</strong>：浏览器/手机型号/操作系统/网络环境</li>
                <li><strong>截图或录屏</strong>：有图有真相</li>
            </ol>
            <div class="bad-example">❌ 坏的Bug报告："系统不好用"、"页面有问题"、"那个功能坏了"</div>
            <div class="good-example">✅ 好的Bug报告：<br>"在Chrome浏览器中，第1步：进入订单列表页，第2步：点击'导出Excel'按钮。预期：下载订单数据的Excel文件。实际：页面显示'网络错误'弹窗，没有下载文件。环境：Win11+Chrome 120"</div>
        `,
        task: '你发现"用户修改头像"功能有问题，请编写一个规范的Bug报告，包含：操作步骤（至少2步）、预期结果、实际结果。',
        hint: '按这个结构写：\n操作步骤：1.xxx 2.xxx\n预期结果：应该xxx\n实际结果：但是实际xxx',
        answer: '参考答案：\n操作步骤：\n1. 登录系统后进入"个人中心"页面\n2. 点击头像区域的"更换头像"按钮\n3. 选择一张2MB的JPG图片并点击确认\n预期结果：头像更新成功，页面显示新头像\n实际结果：上传进度条到100%后提示"上传失败"，头像未更新\n环境：Win11 + Chrome 120',
        validate(text) {
            const t = text.trim();
            return [
                { pass: /步骤|第[一二三1-3]步|1\.|操作/.test(t), msg: '包含操作步骤描述' },
                { pass: /预期|期望|应该|应当/.test(t), msg: '包含预期结果说明' },
                { pass: /实际|结果是|但是|却|然而|实际上/.test(t), msg: '包含实际结果说明' },
                { pass: t.length >= 40, msg: '描述足够具体（不少于40字）' }
            ];
        }
    },
    {
        id: 18, phase: 4, type: 'choice',
        title: '需求变更管理',
        description: '掌握正确的需求变更流程',
        tutorial: `
            <p>需求变更不可避免，但必须<strong>走正规流程</strong>，否则项目必然失控：</p>
            <ol>
                <li><strong>提出变更</strong>：甲方书面提出变更内容</li>
                <li><strong>影响评估</strong>：开发方评估影响范围、额外工时和费用</li>
                <li><strong>双方确认</strong>：对工时和费用达成一致，书面确认</li>
                <li><strong>排入计划</strong>：纳入开发计划，调整里程碑</li>
            </ol>
            <div class="bad-example">❌ 口头说一句"帮我加个功能呗"，然后等验收时说"这不是当初说好的吗？"</div>
            <div class="good-example">✅ 发起书面变更申请 → 评估影响 → 确认费用和工期变化 → 签字确认 → 开发</div>
            <div class="key-point">每次变更都留下书面记录（邮件/文档），是保护甲乙双方的最好方式。</div>
        `,
        task: '项目已开发70%，甲方要求增加"微信扫码登录"功能，以下做法最恰当的是？',
        choices: [
            'A) 口头告诉开发"赶紧加上"，工期和费用不变',
            'B) 书面提出变更申请，评估对工期和费用的影响，双方确认后再开发',
            'C) 等项目全部做完上线后再说',
            'D) 这个功能不重要，放弃算了'
        ],
        correctIndex: 1,
        hint: '变更管理的核心是"评估影响+书面确认"，避免口头约定导致后期纠纷。',
        answer: 'B) 正确的做法是走正规变更流程：书面提出→评估影响（微信扫码登录需要对接微信开放平台，额外3-5天开发+测试）→确认增加的费用和工期→双方签字→排入开发计划。口头沟通是扯皮的根源。'
    },
    {
        id: 19, phase: 4, type: 'choice',
        title: '项目里程碑设置',
        description: '学会合理设置项目检查节点',
        tutorial: `
            <p>里程碑是项目的<strong>检查节点</strong>，好比长途旅行中的加油站——每到一个点就检查一下是否偏航。</p>
            <p>推荐的里程碑设置：</p>
            <div class="syntax-block">M1: 需求确认    → 产出需求文档，双方签字
M2: UI设计完成  → 产出设计稿，甲方确认
M3: 核心功能联调 → 核心功能可演示
M4: 内部测试    → 提交测试报告
M5: 用户验收(UAT) → 甲方实际使用测试
M6: 正式上线    → 系统部署上线
M7: 质保期满    → 移交运维</div>
            <p>每个里程碑必须有：</p>
            <ul>
                <li>明确的<strong>时间节点</strong></li>
                <li>可检查的<strong>交付物</strong></li>
                <li>清晰的<strong>验收标准</strong></li>
            </ul>
        `,
        task: '以下哪个里程碑安排是最合理的？',
        choices: [
            'A) 签合同 → 3个月后交付完整系统',
            'B) 需求确认 → UI确认 → 核心功能演示 → 测试 → 验收 → 上线',
            'C) 开始写代码 → 上线',
            'D) 设计 → 上线 → 测试'
        ],
        correctIndex: 1,
        hint: '好的里程碑应该循序渐进，每个阶段都有可检查的产出物，而不是一步到位。',
        answer: 'B) 分6个节点逐步推进，每个阶段都有可交付的成果物，甲方可以及时发现问题并纠正方向。A中间没有检查点，3个月后才发现做错就晚了；C缺少设计和测试；D把测试放在上线后是本末倒置。'
    },
    {
        id: 20, phase: 4, type: 'choice',
        title: '项目验收要点',
        description: '学会系统性验收项目交付物',
        tutorial: `
            <p>项目验收是甲方最重要的权利，必须<strong>全面、系统、有标准</strong>：</p>
            <ol>
                <li><strong>功能验收</strong>：需求文档中所有功能都实现了吗？</li>
                <li><strong>性能验收</strong>：响应时间、并发量达标了吗？</li>
                <li><strong>兼容性验收</strong>：各浏览器/设备都能正常使用吗？</li>
                <li><strong>安全验收</strong>：有没有明显的安全漏洞？</li>
                <li><strong>文档交付</strong>：需求文档、接口文档、部署文档齐全吗？</li>
                <li><strong>源代码交付</strong>：完整的、可编译运行的源代码</li>
                <li><strong>环境信息</strong>：服务器、域名、数据库等所有账号信息</li>
                <li><strong>培训</strong>：用户和管理员操作培训</li>
            </ol>
            <div class="key-point">千万不要只看"功能能不能用"就签字验收。缺少源代码和文档交付，等于把自己的命脉交给了别人。</div>
        `,
        task: '项目验收时，以下哪一项最容易被甲方忽略但又非常重要？',
        choices: [
            'A) 首页的动画效果是否炫酷',
            'B) 完整的源代码和技术文档交付',
            'C) Logo的尺寸是否精确到像素级别',
            'D) 按钮的圆角大小是否统一'
        ],
        correctIndex: 1,
        hint: '哪个选项关系到你未来能否自主维护和迭代系统？',
        answer: 'B) 源代码和文档是项目的核心资产。没有源代码，你无法换团队维护；没有文档，新团队接手时间翻倍。ACD都是UI细节，虽然也要关注但远不如代码和文档重要。'
    },

    // ==================== Phase 5: 防坑指南 ====================
    {
        id: 21, phase: 5, type: 'choice',
        title: '识别不靠谱报价',
        description: '练习识别报价中的危险信号',
        tutorial: `
            <p>报价异常的<strong>红旗信号</strong>：</p>
            <ul>
                <li>🚩 报价远低于市场价 → 可能偷工减料或后期加价</li>
                <li>🚩 什么功能都说"很简单" → 没有认真评估需求</li>
                <li>🚩 不提供详细报价清单 → 后期扯皮的伏笔</li>
                <li>🚩 承诺极短工期 → 质量堪忧或根本做不完</li>
                <li>🚩 不愿意签合同 → 没有保障</li>
            </ul>
            <p>靠谱的报价应该：</p>
            <ul>
                <li>✅ 有详细的功能清单和对应工时</li>
                <li>✅ 每项功能都有明确的工时和单价</li>
                <li>✅ 包含测试和联调时间</li>
                <li>✅ 包含合理的缓冲余量（10-20%）</li>
                <li>✅ 附带付款方式和里程碑</li>
            </ul>
        `,
        task: '甲方为同一个中型管理系统收到3份报价：A公司5万/1个月、B公司18万/3个月（含80页详细清单）、C公司3万/2周。应该如何选择？',
        context: `
            <div class="context-label">项目情况：</div>
            <div class="scenario-block">项目类型：中型企业管理系统
功能模块：用户管理、审批流程、报表看板、消息通知
预估用户：200人
要求：PC端+移动端适配</div>
        `,
        choices: [
            'A) 选A公司——便宜又快，性价比高',
            'B) 选B公司——报价合理，有详细清单，工期务实',
            'C) 选C公司——最便宜，省钱',
            'D) 把三家的报价都压到最低，谁最便宜选谁'
        ],
        correctIndex: 1,
        hint: '对比市场价计算一下：中型系统3个月×2-3人开发，合理成本大约是多少？',
        answer: 'B) B公司报价合理（与人力成本匹配），有详细的80页功能清单（说明认真评估了需求），3个月工期务实。A公司5万/1月明显偏低（可能偷工减料或后期加价），C公司3万/2周极不合理（不可能完成）。D以最低价选择是最常见的甲方误区。'
    },
    {
        id: 22, phase: 5, type: 'choice',
        title: '合同关键条款',
        description: '掌握软件开发合同中必不可少的条款',
        tutorial: `
            <p>软件开发合同中<strong>必须包含</strong>的条款：</p>
            <ol>
                <li><strong>项目范围</strong>：明确的功能需求清单（作为合同附件）</li>
                <li><strong>交付物清单</strong>：源代码、文档、设计稿、数据库脚本等</li>
                <li><strong>里程碑和付款计划</strong>：分阶段付款</li>
                <li><strong>知识产权归属</strong>：源代码和设计稿归谁所有</li>
                <li><strong>质保期</strong>：免费修Bug的期限（通常3-12个月）</li>
                <li><strong>验收标准和流程</strong>：怎样算交付完成</li>
                <li><strong>变更管理条款</strong>：需求变更怎么处理</li>
                <li><strong>违约责任</strong>：延期或质量不达标怎么办</li>
                <li><strong>保密条款</strong>：业务数据和源代码的保密</li>
            </ol>
        `,
        task: '以下哪种付款方式对甲方的风险控制最有利？',
        choices: [
            'A) 签合同时一次性付清100%全款',
            'B) 3-3-3-1分期：签约30%，UI确认30%，验收通过30%，质保期满10%',
            'C) 项目做完后一次性付100%',
            'D) 先付80%，质保期满后付20%'
        ],
        correctIndex: 1,
        hint: '最好的付款方式应该是：每个阶段做完了才付对应的款项，且保留一部分到质保期满。',
        answer: 'B) 3-3-3-1分期付款最合理：30%启动金保证开发方有资金开始做事；30%在UI确认后支付保证方向正确；30%在验收后支付确保功能完成；10%留到质保期满确保售后服务。A风险最高（钱付完没动力做好），C对开发方不公平，D前期付太多。'
    },
    {
        id: 23, phase: 5, type: 'choice',
        title: '源代码与知识产权',
        description: '确保你拥有自己项目的核心资产',
        tutorial: `
            <p>源代码归属是<strong>最容易产生纠纷</strong>的问题：</p>
            <ul>
                <li><strong>源代码归属</strong>：合同必须明确"甲方付清全款后源代码归甲方所有"</li>
                <li><strong>第三方组件</strong>：开发中使用的开源/商业组件的版权情况</li>
                <li><strong>数据归属</strong>：系统运行产生的业务数据归甲方所有</li>
            </ul>
            <p>交付时必须获得：</p>
            <ul>
                <li>✅ 完整的、可独立编译运行的源代码</li>
                <li>✅ 代码版本管理仓库的完整历史</li>
                <li>✅ 技术文档和数据库设计文档</li>
                <li>✅ 第三方组件/服务的清单和授权说明</li>
            </ul>
            <div class="key-point">如果合同中没有写明代码归属，默认情况下代码可能归开发方！这意味着你花钱做的系统，换团队维护时可能遭遇法律风险。</div>
        `,
        task: '关于源代码归属，以下说法正确的是？',
        choices: [
            'A) 谁写的代码就归谁，甲方花钱也只有使用权',
            'B) 应在合同中明确约定源代码归属，甲方付清全款后应获得完整源代码所有权',
            'C) 不需要关心源代码，只要系统能用就行',
            'D) 拿到系统的安装包就够了，不需要源代码'
        ],
        correctIndex: 1,
        hint: '想想：如果你没有源代码，将来想换团队维护或者增加新功能怎么办？',
        answer: 'B) 合同中必须明确约定源代码归属权。没有源代码意味着：换不了团队、被锁定在原开发方、无法审计安全问题、无法自主迭代。A在法律上不完全正确（委托开发可约定归属），C和D是短视的做法。'
    },
    {
        id: 24, phase: 5, type: 'choice',
        title: '评估外协团队',
        description: '识别靠谱的外协团队和危险信号',
        tutorial: `
            <p>评估外协团队的<strong>关键维度</strong>：</p>
            <ul>
                <li>✅ <strong>过往案例</strong>：有无类似项目经验？能否提供演示？</li>
                <li>✅ <strong>团队稳定性</strong>：核心成员是否固定？是否有人员流动风险？</li>
                <li>✅ <strong>技术匹配度</strong>：技术栈是否符合你的需求？</li>
                <li>✅ <strong>沟通响应</strong>：需求确认和问题回复是否及时？</li>
                <li>✅ <strong>合同规范</strong>：是否愿意签正规合同并分阶段付款？</li>
                <li>✅ <strong>售后方案</strong>：是否有明确的质保期和维护方案？</li>
            </ul>
            <p>红旗信号 🚩：</p>
            <ul>
                <li>🚩 无法提供任何过往案例</li>
                <li>🚩 团队成员不固定，经常换人</li>
                <li>🚩 拒绝分阶段付款，要求一次性全款</li>
                <li>🚩 不愿意签详细合同</li>
                <li>🚩 承诺什么都能做、什么都很简单</li>
            </ul>
        `,
        task: '在评估外协团队时，以下哪个是最严重的危险信号？',
        choices: [
            'A) 报价比同行略高10-15%',
            'B) 拒绝提供过往案例，且不愿签详细合同、要求一次性全款',
            'C) 建议使用你不太熟悉的技术框架',
            'D) 项目经理比较年轻'
        ],
        correctIndex: 1,
        hint: '哪个选项同时触碰了多个"红旗信号"？',
        answer: 'B) 三个红旗信号叠加：无案例（可能没经验或做得很差）、不签详细合同（不愿承担责任）、一次性全款（拿钱跑路风险极高）。A略高的报价反而可能代表更好的质量；C可能是专业建议；D与能力无直接关系。'
    },
    {
        id: 25, phase: 5, type: 'choice',
        title: '交接与维护',
        description: '确保项目上线后你不会被"卡脖子"',
        tutorial: `
            <p>项目上线<strong>不是终点</strong>，而是运营的起点。完整的技术交接清单：</p>
            <ol>
                <li>✅ 完整源代码（含Git版本历史）</li>
                <li>✅ 数据库设计文档和数据字典</li>
                <li>✅ API接口文档</li>
                <li>✅ 系统部署文档（环境搭建、部署步骤）</li>
                <li>✅ 服务器/域名/SSL的账号和密码</li>
                <li>✅ 第三方服务的账号信息（短信、支付、云存储等）</li>
                <li>✅ 操作手册（用户版和管理员版）</li>
                <li>✅ 测试用例文档</li>
            </ol>
            <p>维护期注意事项：</p>
            <ul>
                <li>明确"Bug修复"和"新需求"的界定标准</li>
                <li>紧急Bug的响应时间约定（如4小时内响应）</li>
                <li>质保期结束后的续约费用</li>
            </ul>
        `,
        task: '项目交付后，以下哪件事最重要但最容易被忽略？',
        choices: [
            'A) 举办庆祝上线的团建活动',
            'B) 获得所有源代码、文档和账号信息，确认能独立编译运行',
            'C) 立刻规划下一期新功能',
            'D) 在公司内部发邮件宣传新系统'
        ],
        correctIndex: 1,
        hint: '如果明天开发团队消失了，你能不能独立维护和运行这个系统？',
        answer: 'B) 获得完整交接资料并验证可独立运行是最关键的。必须确认：源代码能在你自己的环境上编译运行、文档齐全、所有账号都在你手上。否则一旦与开发方出现纠纷，你的系统就可能被"卡脖子"。'
    },

    // ==================== Phase 6: AI协作进阶 ====================
    {
        id: 26, phase: 6, type: 'text',
        title: '给AI写需求的技巧',
        description: '学会高效地向AI描述开发需求',
        tutorial: `
            <p>和AI沟通需求的<strong>核心技巧</strong>：</p>
            <ol>
                <li><strong>提供上下文</strong>：先说你在做什么项目、什么场景</li>
                <li><strong>明确技术栈</strong>：用什么语言、框架、库</li>
                <li><strong>分步骤提需求</strong>：一次只说一个功能点</li>
                <li><strong>提供示例</strong>：输入什么、输出什么、参考什么</li>
                <li><strong>明确约束</strong>：格式、规则、边界条件</li>
            </ol>
            <div class="bad-example">❌ "写一个管理系统"——太模糊，AI不知道你要什么</div>
            <div class="good-example">✅ "用 Vue3 + Element Plus 写一个员工列表页面：<br>• 表格显示：姓名、部门、职位、入职日期<br>• 支持按部门下拉筛选<br>• 分页展示，每页10条<br>• 点击行弹出编辑对话框"</div>
            <div class="key-point">给AI的需求越具体，产出质量越高。模糊的输入只会得到模糊的输出。</div>
        `,
        task: '请写一段给AI的需求描述，让AI帮你生成一个"待办事项管理"功能页面。需明确技术栈、至少3个功能点和界面要求。',
        hint: '先说用什么技术（如HTML+CSS+JS），再逐条列出具体功能（添加待办、标记完成、删除、筛选等），最后说界面风格。',
        answer: '参考答案：请用 HTML + CSS + JavaScript 开发一个待办事项管理页面：\n1. 顶部有输入框和添加按钮，输入待办内容后按回车或点击按钮添加\n2. 待办列表展示所有事项，每项左侧有复选框标记完成状态，右侧有删除按钮\n3. 已完成的事项显示删除线和灰色文字\n4. 底部显示统计：共X项，已完成X项\n5. 界面风格：简洁卡片式布局，白色背景，圆角阴影',
        validate(text) {
            const t = text.trim();
            return [
                { pass: /html|css|js|javascript|vue|react|前端|技术/i.test(t), msg: '明确了技术栈或开发方式' },
                { pass: /添加|新增|创建|输入/.test(t), msg: '包含"添加/创建"功能描述' },
                { pass: /完成|勾选|标记|删除|移除/.test(t), msg: '包含状态操作功能描述' },
                { pass: /列表|展示|显示|页面|界面/.test(t), msg: '包含界面展示要求' },
                { pass: t.length >= 50, msg: '描述足够具体（不少于50字）' }
            ];
        }
    },
    {
        id: 27, phase: 6, type: 'choice',
        title: 'AI能力边界认知',
        description: '理解AI能做什么和不擅长什么',
        tutorial: `
            <p>AI（如ChatGPT/Claude/Cursor）在编程方面的<strong>能力</strong>：</p>
            <ul>
                <li>✅ 生成标准化代码（CRUD、页面布局、表单验证）</li>
                <li>✅ 编写SQL查询、正则表达式</li>
                <li>✅ 解释、优化和重构现有代码</li>
                <li>✅ 生成单元测试用例</li>
                <li>✅ 编写技术文档和注释</li>
                <li>✅ 根据明确需求开发完整的小工具</li>
            </ul>
            <p>AI<strong>不擅长</strong>的：</p>
            <ul>
                <li>❌ 复杂的系统架构设计（需要全局视角和经验）</li>
                <li>❌ 深度性能调优（需要具体环境和压测数据）</li>
                <li>❌ 安全加固和渗透测试（需要专业安全知识）</li>
                <li>❌ 处理遗留系统（需要理解历史背景和业务逻辑）</li>
                <li>❌ 大型项目的端到端交付（需要持续管理和迭代）</li>
                <li>❌ 可能"编造"不存在的API或函数（AI幻觉）</li>
            </ul>
        `,
        task: '以下哪个任务最适合交给AI完成？',
        choices: [
            'A) 为一个百万用户的系统设计整体架构',
            'B) 根据已有的数据库表结构，生成增删改查的API代码和页面',
            'C) 排查生产环境的内存泄漏问题',
            'D) 为公司制定3年IT战略规划'
        ],
        correctIndex: 1,
        hint: '哪个任务的输入最明确（有具体的表结构），输出最标准化（CRUD代码有固定模式）？',
        answer: 'B) 根据表结构生成CRUD代码是AI最擅长的场景：输入明确（表名、字段名、类型）、输出标准化（增删改查的代码模式固定）、不需要额外的业务知识。ACD要么需要全局经验判断，要么需要实际运行环境。'
    },
    {
        id: 28, phase: 6, type: 'choice',
        title: '评审AI生成的代码',
        description: '学会检查AI产出物的关键要点',
        tutorial: `
            <p>AI生成的代码<strong>不能直接用</strong>，必须经过人工评审：</p>
            <ol>
                <li><strong>逻辑正确性</strong>：代码逻辑是否真正符合需求？</li>
                <li><strong>安全性</strong>：有没有SQL注入、XSS跨站脚本等漏洞？</li>
                <li><strong>AI幻觉</strong>：是否使用了不存在的API或函数？</li>
                <li><strong>错误处理</strong>：异常情况（网络断开、数据为空等）是否处理了？</li>
                <li><strong>性能问题</strong>：有没有循环查询数据库等性能陷阱？</li>
                <li><strong>依赖安全</strong>：引用的第三方库是否可信和最新？</li>
            </ol>
            <div class="key-point">AI就像一个写代码很快但经验不足的实习生——产出速度快，但需要老手把关质量。甲方的角色就是确保有"老手"在把关。</div>
        `,
        task: 'AI生成了一段用户登录代码，以下哪个检查项是最关键的？',
        choices: [
            'A) 代码缩进和空格是否美观统一',
            'B) 是否包含密码加密存储、防暴力破解、SQL注入防护等安全措施',
            'C) 变量命名是否使用驼峰命名法',
            'D) 代码注释是否使用中文还是英文'
        ],
        correctIndex: 1,
        hint: '登录功能直接关系到用户账号安全，哪些检查点是"安全底线"？',
        answer: 'B) 登录是系统安全的第一道防线。密码明文存储可被拖库盗取、无防暴力破解可被穷举攻击、无SQL注入防护可被黑客获取所有用户数据。这些安全问题的后果远比代码风格严重。ACD是代码规范问题，重要但不致命。'
    },
    {
        id: 29, phase: 6, type: 'text',
        title: '完整项目需求文档',
        description: '综合运用所学，编写一份规范的需求文档摘要',
        tutorial: `
            <p>一份完整的项目需求文档应包含：</p>
            <ol>
                <li><strong>项目概述</strong>：背景、目标、预期价值</li>
                <li><strong>用户角色</strong>：不同类型用户的权限和操作</li>
                <li><strong>功能需求清单</strong>：按模块列出所有功能</li>
                <li><strong>非功能需求</strong>：性能、安全、兼容性要求</li>
                <li><strong>界面参考</strong>：参考产品截图或线框图</li>
                <li><strong>数据需求</strong>：需要管理哪些核心数据</li>
                <li><strong>验收标准</strong>：每个功能的验收条件</li>
            </ol>
            <div class="key-point">这份文档将成为合同附件，是验收时的唯一依据。写得越清楚，后期纠纷越少。</div>
        `,
        task: '请为"公司内部知识库系统"写一段需求摘要，要求包含：项目目标、至少2种用户角色、至少4个核心功能、至少1条非功能需求。',
        hint: '知识库系统：谁用？（普通员工查知识、管理员管理内容）有什么功能？（文章发布、搜索、分类、收藏、评论...）系统要达到什么标准？（搜索响应快、支持多少人...）',
        answer: '参考答案：\n项目目标：建设公司内部知识库，沉淀业务经验和技术文档，解决知识分散、查找困难的问题。\n用户角色：普通员工（浏览和搜索知识）、内容管理员（发布和管理文章）、系统管理员（管理分类和权限）。\n核心功能：1.文章发布与编辑（支持富文本和附件）2.全文搜索（按关键词、分类、标签搜索）3.知识分类管理（多级分类目录）4.个人收藏和浏览历史 5.评论和点赞互动。\n非功能需求：搜索结果响应时间不超过2秒，支持200人同时在线访问。',
        validate(text) {
            const t = text.trim();
            return [
                { pass: /目标|目的|背景|解决/.test(t), msg: '包含项目目标说明' },
                { pass: /员工|管理员|用户|角色/.test(t), msg: '描述了用户角色' },
                { pass: (t.match(/发布|搜索|分类|收藏|评论|编辑|浏览|管理|上传|下载|查看|审核|统计|标签/g) || []).length >= 4, msg: '列出了至少4个核心功能' },
                { pass: /秒|并发|可用|兼容|安全|性能|在线|响应/.test(t), msg: '包含非功能需求描述' },
                { pass: t.length >= 80, msg: '内容足够完整（不少于80字）' }
            ];
        }
    },
    {
        id: 30, phase: 6, type: 'choice',
        title: '综合场景决策',
        description: '运用全部所学做出正确的项目决策',
        tutorial: `
            <p>恭喜你来到最后一关！让我们综合运用前面学到的所有知识。</p>
            <p>作为一个合格的甲方，你应该具备：</p>
            <ul>
                <li>📝 <strong>精准表达</strong>：能写出具体、可衡量、可验证的需求</li>
                <li>⚙️ <strong>技术认知</strong>：了解系统架构，能判断方案合理性</li>
                <li>💰 <strong>成本意识</strong>：能判断报价和工期是否合理</li>
                <li>🤝 <strong>协作能力</strong>：掌握规范的沟通和变更流程</li>
                <li>🛡️ <strong>风险意识</strong>：能识别合同和交付中的陷阱</li>
                <li>🤖 <strong>AI素养</strong>：能高效利用AI提升效率</li>
            </ul>
            <div class="key-point">记住：好的甲方不是对技术了如指掌的人，而是知道"该问什么问题"的人。</div>
        `,
        task: '你收到一个外协团队的项目方案：报价8万，工期1个月，2人团队，不提供源代码（只给部署包），要求签合同前先付80%，没有质保期条款，说什么需求都回答"很简单"。这个方案有几处明显风险？',
        context: `
            <div class="context-label">项目情况：</div>
            <div class="scenario-block">项目：内部办公自动化系统
功能：考勤管理、请假审批、报销管理、通知公告、数据报表
用户：全公司300人使用
要求：PC端 + 移动端适配</div>
            <div class="context-label">外协方案详情：</div>
            <div class="scenario-block">报价：8万元
工期：1个月
团队：2人
交付物：部署包（不含源代码）
付款方式：签合同付80%，上线付20%
质保期：未提及
对功能评估："都很简单，1个月绰绰有余"</div>
        `,
        choices: [
            'A) 只有1-2处小问题，整体还行',
            'B) 有3-4处风险，需要协商',
            'C) 有5-6处严重风险，高度不建议合作',
            'D) 方案完美，没有问题'
        ],
        correctIndex: 2,
        hint: '逐一对照我们学过的知识点：报价是否合理？工期是否现实？交付物完整吗？付款方式安全吗？有质保吗？"都很简单"正常吗？',
        answer: 'C) 至少有6处严重风险：\n1. 工期不合理：5个功能模块+移动端适配，2人1个月完成不现实（至少需要2-3个月）\n2. 不提供源代码：无法换团队维护，被永久锁定\n3. 付款比例失衡：签约就付80%，对方做烂了你也没有制约手段\n4. 没有质保期：上线后发现Bug无人负责\n5. "什么都很简单"：典型的没有认真评估需求的信号\n6. 报价偏低：5个模块+移动端适配的系统，8万元明显低于合理市场价'
    }
];

// ===== 状态管理 =====
const STORAGE_KEY = 'client-learn-progress';
let currentLevelIdx = -1;

function getProgress() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch { return {}; }
}

function saveProgress(levelId) {
    const prog = getProgress();
    prog[levelId] = true;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prog));
}

function isLevelCompleted(levelId) {
    return !!getProgress()[levelId];
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

    document.getElementById('levelSelect').style.display = 'none';
    document.getElementById('levelDetail').style.display = '';
    document.getElementById('appInfo').style.display = 'none';

    document.getElementById('levelTitle').textContent = `第 ${level.id} 关：${level.title}`;
    document.getElementById('tutorialContent').innerHTML = level.tutorial;
    document.getElementById('taskContent').innerHTML = level.task;

    // 场景信息
    const contextSection = document.getElementById('contextSection');
    if (level.context) {
        contextSection.style.display = '';
        document.getElementById('contextContent').innerHTML = level.context;
    } else {
        contextSection.style.display = 'none';
    }

    // 渲染答题区域
    renderAnswerArea(level);

    // 结果重置
    document.getElementById('resultArea').innerHTML = '<p class="placeholder-text">提交回答后在此查看结果</p>';
    document.getElementById('hintBox').style.display = 'none';
    document.getElementById('expectedSection').style.display = 'none';

    // 导航按钮
    document.getElementById('btnPrevLevel').disabled = (idx === 0);
    const nextUnlocked = idx + 1 < LEVELS.length && isLevelUnlocked(idx + 1);
    document.getElementById('btnNextLevel').disabled = !nextUnlocked;
}

function renderAnswerArea(level) {
    const area = document.getElementById('answerArea');
    if (level.type === 'choice') {
        area.innerHTML = `<div class="choice-list">${
            level.choices.map((c, i) => `
                <label class="choice-item" data-idx="${i}">
                    <input type="radio" name="answer" value="${i}">
                    <span class="choice-text">${c}</span>
                </label>
            `).join('')
        }</div>`;
        // 点击选项高亮
        area.querySelectorAll('.choice-item').forEach(item => {
            item.addEventListener('click', () => {
                area.querySelectorAll('.choice-item').forEach(el => el.classList.remove('selected'));
                item.classList.add('selected');
                item.querySelector('input').checked = true;
            });
        });
    } else {
        area.innerHTML = `<textarea id="textAnswer" class="text-editor" placeholder="在此输入你的回答..." spellcheck="false"></textarea>`;
    }
}

function getUserAnswer(level) {
    if (level.type === 'choice') {
        const checked = document.querySelector('#answerArea input[name="answer"]:checked');
        return checked ? parseInt(checked.value) : -1;
    } else {
        const textarea = document.getElementById('textAnswer');
        return textarea ? textarea.value.trim() : '';
    }
}

// ===== 验证逻辑 =====
function handleRun() {
    const level = LEVELS[currentLevelIdx];
    const userAnswer = getUserAnswer(level);

    if (level.type === 'choice' && userAnswer === -1) return;
    if (level.type === 'text' && userAnswer === '') return;

    const resultArea = document.getElementById('resultArea');
    let checks;

    if (level.type === 'choice') {
        checks = [
            { pass: userAnswer === level.correctIndex, msg: userAnswer === level.correctIndex ? '选择了正确答案！' : `你选择了${level.choices[userAnswer]}，不是最佳答案` }
        ];
    } else {
        checks = level.validate(userAnswer);
    }

    const allPass = checks.every(c => c.pass);

    let html = '<ul class="check-list">';
    checks.forEach(c => {
        const cls = c.pass ? 'pass' : 'fail';
        const icon = c.pass ? '✅' : '❌';
        html += `<li class="${cls}"><span class="check-icon">${icon}</span>${c.msg}</li>`;
    });
    html += '</ul>';

    if (allPass) {
        resultArea.innerHTML = '<div class="success-msg">✅ 回答正确！</div>' + html;
        document.getElementById('expectedSection').style.display = 'none';
        saveProgress(level.id);
        showSuccessModal(level);
    } else {
        const passCount = checks.filter(c => c.pass).length;
        resultArea.innerHTML = `<div class="fail-msg">⚠️ 通过 ${passCount}/${checks.length} 项检查，请继续完善。</div>` + html;
        const expectedSection = document.getElementById('expectedSection');
        expectedSection.style.display = '';
        document.getElementById('expectedArea').innerHTML = `<div class="answer-block">${level.answer}</div>`;
    }
}

function showSuccessModal(level) {
    const modal = document.getElementById('successModal');
    const idx = LEVELS.indexOf(level);
    const isLast = idx === LEVELS.length - 1;

    document.getElementById('successMsg').textContent = isLast
        ? '恭喜你完成所有关卡！你已掌握甲方的核心素养，可以自信地管理软件项目了！'
        : `你已掌握「${level.title}」，继续挑战下一关吧！`;

    document.getElementById('btnNextFromModal').style.display = isLast ? 'none' : '';
    modal.style.display = 'flex';
}

function handleHint() {
    const level = LEVELS[currentLevelIdx];
    const box = document.getElementById('hintBox');
    box.textContent = level.hint;
    box.style.display = box.style.display === 'none' ? '' : 'none';
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

    // Ctrl+Enter 提交
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && currentLevelIdx >= 0) {
            e.preventDefault();
            handleRun();
        }
    });
});
