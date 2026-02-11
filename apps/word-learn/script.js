// ===== 关卡数据 =====
var LEVELS = [
    // ===== 第一阶段：基础入门 =====
    {
        id: 1,
        title: '创建第一个Word文档',
        description: '认识 docx 库，创建你的第一个文档',
        tutorial: '\
            <p><strong>docx</strong> 是一个强大的 JavaScript 库，可以在浏览器中直接生成 Word（.docx）文件，无需后端支持。</p>\
            <p>创建文档的核心结构：</p>\
            <div class="syntax-block">var doc = new docx.Document({\n\
    sections: [{\n\
        children: [\n\
            new docx.Paragraph({\n\
                children: [new docx.TextRun("文本内容")]\n\
            })\n\
        ]\n\
    }]\n\
});</div>\
            <p>关键概念：</p>\
            <ul style="margin:8px 0 8px 20px;line-height:2;">\
                <li><code>Document</code>：整个 Word 文档</li>\
                <li><code>sections</code>：文档的节（至少一个）</li>\
                <li><code>Paragraph</code>：段落</li>\
                <li><code>TextRun</code>：一段连续的文本</li>\
            </ul>\
        ',
        task: '创建一个包含 <code>"Hello World"</code> 文本的 Word 文档，赋值给 <code>result</code>。',
        hint: 'var result = new docx.Document({\n    sections: [{\n        children: [\n            new docx.Paragraph({\n                children: [new docx.TextRun("Hello World")]\n            })\n        ]\n    }]\n});',
        setupCode: '',
        previewData: null,
        answer: 'var result = new docx.Document({\n    sections: [{\n        children: [\n            new docx.Paragraph({\n                children: [new docx.TextRun("Hello World")]\n            })\n        ]\n    }]\n});',
        validate: function(xml) {
            return [
                { pass: xml.indexOf('Hello World') !== -1, msg: '文档包含文本 "Hello World"' },
                { pass: (xml.match(/<w:p[ >]/g) || []).length >= 1, msg: '文档包含至少一个段落' }
            ];
        }
    },
    {
        id: 2,
        title: '多段落文档',
        description: '在文档中添加多个段落',
        tutorial: '\
            <p>在 <code>children</code> 数组中添加多个 <code>Paragraph</code> 对象，即可创建多段落文档：</p>\
            <div class="syntax-block">children: [\n\
    new docx.Paragraph({\n\
        children: [new docx.TextRun("第一段")]\n\
    }),\n\
    new docx.Paragraph({\n\
        children: [new docx.TextRun("第二段")]\n\
    }),\n\
    new docx.Paragraph({\n\
        children: [new docx.TextRun("第三段")]\n\
    })\n\
]</div>\
            <p>每个 <code>Paragraph</code> 在 Word 中会独占一行，就像你在 Word 里按回车换行一样。</p>\
        ',
        task: '创建一个包含 3 个段落的文档，内容分别为：<code>"数据收集与整理"</code>、<code>"数据分析与处理"</code>、<code>"数据可视化展示"</code>。赋值给 <code>result</code>。',
        hint: '在 sections 的 children 中放入 3 个 new docx.Paragraph({...})，每个包含对应的 TextRun。',
        setupCode: '',
        previewData: null,
        answer: 'var result = new docx.Document({\n    sections: [{\n        children: [\n            new docx.Paragraph({ children: [new docx.TextRun("数据收集与整理")] }),\n            new docx.Paragraph({ children: [new docx.TextRun("数据分析与处理")] }),\n            new docx.Paragraph({ children: [new docx.TextRun("数据可视化展示")] })\n        ]\n    }]\n});',
        validate: function(xml) {
            return [
                { pass: xml.indexOf('数据收集与整理') !== -1, msg: '包含文本 "数据收集与整理"' },
                { pass: xml.indexOf('数据分析与处理') !== -1, msg: '包含文本 "数据分析与处理"' },
                { pass: xml.indexOf('数据可视化展示') !== -1, msg: '包含文本 "数据可视化展示"' }
            ];
        }
    },

    // ===== 第二阶段：文本格式 =====
    {
        id: 3,
        title: '文本加粗与斜体',
        description: '学习设置文本的加粗和斜体',
        tutorial: '\
            <p><code>TextRun</code> 除了传入纯字符串，还可以传入<strong>配置对象</strong>来设置格式：</p>\
            <div class="syntax-block">new docx.TextRun({\n\
    text: "加粗文本",\n\
    bold: true\n\
})\n\
\n\
new docx.TextRun({\n\
    text: "斜体文本",\n\
    italics: true\n\
})</div>\
            <p>注意：<code>bold</code> 和 <code>italics</code> 都是布尔值，设为 <code>true</code> 即可生效。</p>\
        ',
        task: '创建文档，包含两个段落：第一段文字 <code>"重要提醒"</code> 设为<strong>加粗</strong>，第二段文字 <code>"备注信息"</code> 设为<strong>斜体</strong>。赋值给 <code>result</code>。',
        hint: '第一段用 new docx.TextRun({ text: "重要提醒", bold: true })\n第二段用 new docx.TextRun({ text: "备注信息", italics: true })',
        setupCode: '',
        previewData: null,
        answer: 'var result = new docx.Document({\n    sections: [{\n        children: [\n            new docx.Paragraph({\n                children: [new docx.TextRun({ text: "重要提醒", bold: true })]\n            }),\n            new docx.Paragraph({\n                children: [new docx.TextRun({ text: "备注信息", italics: true })]\n            })\n        ]\n    }]\n});',
        validate: function(xml) {
            var runs = extractRuns(xml);
            var boldRun = runs.find(function(r) { return r.text.indexOf('重要提醒') !== -1; });
            var italicRun = runs.find(function(r) { return r.text.indexOf('备注信息') !== -1; });
            return [
                { pass: !!boldRun, msg: '包含文本 "重要提醒"' },
                { pass: boldRun && boldRun.bold, msg: '"重要提醒" 设置为加粗' },
                { pass: !!italicRun, msg: '包含文本 "备注信息"' },
                { pass: italicRun && italicRun.italic, msg: '"备注信息" 设置为斜体' }
            ];
        }
    },
    {
        id: 4,
        title: '字号与颜色',
        description: '设置文字大小和颜色',
        tutorial: '\
            <p>通过 <code>size</code> 和 <code>color</code> 属性设置字号和颜色：</p>\
            <div class="syntax-block">new docx.TextRun({\n\
    text: "大号红色文字",\n\
    size: 48,      // 单位：半磅，48 = 24磅\n\
    color: "FF0000" // 十六进制颜色，不带 #\n\
})</div>\
            <p><strong>size 单位说明：</strong>docx 中 size 的单位是<strong>半磅（half-point）</strong>。常用换算：</p>\
            <ul style="margin:8px 0 8px 20px;line-height:2;">\
                <li>小四号 ≈ 24（12磅）</li>\
                <li>四号 ≈ 28（14磅）</li>\
                <li>三号 ≈ 32（16磅）</li>\
                <li>二号 ≈ 44（22磅）</li>\
                <li>一号 ≈ 52（26磅）</li>\
            </ul>\
            <p><strong>color 格式：</strong>使用 6 位十六进制色值，不需要 # 前缀。如红色 <code>"FF0000"</code>，蓝色 <code>"0000FF"</code>。</p>\
        ',
        task: '创建文档，包含一个段落，文本为 <code>"数据分析报告"</code>，字号设为 <code>48</code>（24磅），颜色设为红色 <code>"FF0000"</code>。赋值给 <code>result</code>。',
        hint: 'new docx.TextRun({ text: "数据分析报告", size: 48, color: "FF0000" })',
        setupCode: '',
        previewData: null,
        answer: 'var result = new docx.Document({\n    sections: [{\n        children: [\n            new docx.Paragraph({\n                children: [new docx.TextRun({\n                    text: "数据分析报告",\n                    size: 48,\n                    color: "FF0000"\n                })]\n            })\n        ]\n    }]\n});',
        validate: function(xml) {
            var runs = extractRuns(xml);
            var targetRun = runs.find(function(r) { return r.text.indexOf('数据分析报告') !== -1; });
            return [
                { pass: !!targetRun, msg: '包含文本 "数据分析报告"' },
                { pass: targetRun && targetRun.size === '48', msg: '字号设置为 48（24磅）' },
                { pass: targetRun && targetRun.color && targetRun.color.toUpperCase() === 'FF0000', msg: '颜色设置为红色 FF0000' }
            ];
        }
    },
    {
        id: 5,
        title: '混合格式段落',
        description: '在同一段落中混合多种格式',
        tutorial: '\
            <p>一个 <code>Paragraph</code> 的 <code>children</code> 可以包含<strong>多个 TextRun</strong>，每个 TextRun 有独立的格式。这就像在 Word 中选中部分文字设置格式一样：</p>\
            <div class="syntax-block">new docx.Paragraph({\n\
    children: [\n\
        new docx.TextRun({ text: "标签：", bold: true }),\n\
        new docx.TextRun("普通内容"),\n\
        new docx.TextRun({ text: "（重点）", color: "FF0000" })\n\
    ]\n\
})</div>\
            <p>多个 TextRun 在同一行显示，不会换行。只有新建 Paragraph 才会换行。</p>\
        ',
        task: '创建文档，包含一个段落，内容由两个 TextRun 组成：第一个为加粗的 <code>"姓名："</code>，第二个为普通文本 <code>"张三"</code>。赋值给 <code>result</code>。',
        hint: 'children: [\n    new docx.TextRun({ text: "姓名：", bold: true }),\n    new docx.TextRun("张三")\n]',
        setupCode: '',
        previewData: null,
        answer: 'var result = new docx.Document({\n    sections: [{\n        children: [\n            new docx.Paragraph({\n                children: [\n                    new docx.TextRun({ text: "姓名：", bold: true }),\n                    new docx.TextRun("张三")\n                ]\n            })\n        ]\n    }]\n});',
        validate: function(xml) {
            var runs = extractRuns(xml);
            var labelRun = runs.find(function(r) { return r.text.indexOf('姓名') !== -1; });
            var valueRun = runs.find(function(r) { return r.text.indexOf('张三') !== -1; });
            return [
                { pass: !!labelRun, msg: '包含文本 "姓名："' },
                { pass: labelRun && labelRun.bold, msg: '"姓名：" 设置为加粗' },
                { pass: !!valueRun, msg: '包含文本 "张三"' },
                { pass: valueRun && !valueRun.bold, msg: '"张三" 为普通文本（不加粗）' }
            ];
        }
    },

    // ===== 第三阶段：段落排版 =====
    {
        id: 6,
        title: '段落对齐',
        description: '设置段落的对齐方式',
        tutorial: '\
            <p>通过 <code>alignment</code> 属性设置段落对齐方式，使用 <code>docx.AlignmentType</code> 枚举：</p>\
            <div class="syntax-block">new docx.Paragraph({\n\
    alignment: docx.AlignmentType.CENTER,\n\
    children: [new docx.TextRun("居中文本")]\n\
})</div>\
            <p>常用对齐方式：</p>\
            <ul style="margin:8px 0 8px 20px;line-height:2;">\
                <li><code>AlignmentType.LEFT</code>：左对齐（默认）</li>\
                <li><code>AlignmentType.CENTER</code>：居中</li>\
                <li><code>AlignmentType.RIGHT</code>：右对齐</li>\
                <li><code>AlignmentType.JUSTIFIED</code>：两端对齐</li>\
            </ul>\
        ',
        task: '创建文档，包含两个段落：第一段 <code>"数据分析报告"</code> <strong>居中对齐</strong>，第二段 <code>"2024年1月"</code> <strong>右对齐</strong>。赋值给 <code>result</code>。',
        hint: '第一段设 alignment: docx.AlignmentType.CENTER\n第二段设 alignment: docx.AlignmentType.RIGHT',
        setupCode: '',
        previewData: null,
        answer: 'var result = new docx.Document({\n    sections: [{\n        children: [\n            new docx.Paragraph({\n                alignment: docx.AlignmentType.CENTER,\n                children: [new docx.TextRun("数据分析报告")]\n            }),\n            new docx.Paragraph({\n                alignment: docx.AlignmentType.RIGHT,\n                children: [new docx.TextRun("2024年1月")]\n            })\n        ]\n    }]\n});',
        validate: function(xml) {
            return [
                { pass: xml.indexOf('数据分析报告') !== -1, msg: '包含文本 "数据分析报告"' },
                { pass: /<w:jc w:val="center"/.test(xml), msg: '存在居中对齐段落' },
                { pass: xml.indexOf('2024年1月') !== -1, msg: '包含文本 "2024年1月"' },
                { pass: /<w:jc w:val="right"/.test(xml) || /<w:jc w:val="end"/.test(xml), msg: '存在右对齐段落' }
            ];
        }
    },
    {
        id: 7,
        title: '标题样式',
        description: '使用 Heading 创建文档标题层级',
        tutorial: '\
            <p>Word 文档通常有标题层级（标题1、标题2 等）。通过 <code>heading</code> 属性设置：</p>\
            <div class="syntax-block">new docx.Paragraph({\n\
    heading: docx.HeadingLevel.HEADING_1,\n\
    children: [new docx.TextRun("一级标题")]\n\
})\n\
\n\
new docx.Paragraph({\n\
    heading: docx.HeadingLevel.HEADING_2,\n\
    children: [new docx.TextRun("二级标题")]\n\
})</div>\
            <p>可用的标题级别：<code>HEADING_1</code> 到 <code>HEADING_6</code>，数字越小层级越高。</p>\
            <p>不设置 <code>heading</code> 的段落就是普通正文。</p>\
        ',
        task: '创建文档，包含三个段落：一级标题 <code>"年度数据报告"</code>、二级标题 <code>"数据概览"</code>、普通正文 <code>"以下是本年度数据汇总。"</code>。赋值给 <code>result</code>。',
        hint: '第一段设 heading: docx.HeadingLevel.HEADING_1\n第二段设 heading: docx.HeadingLevel.HEADING_2\n第三段不设 heading',
        setupCode: '',
        previewData: null,
        answer: 'var result = new docx.Document({\n    sections: [{\n        children: [\n            new docx.Paragraph({\n                heading: docx.HeadingLevel.HEADING_1,\n                children: [new docx.TextRun("年度数据报告")]\n            }),\n            new docx.Paragraph({\n                heading: docx.HeadingLevel.HEADING_2,\n                children: [new docx.TextRun("数据概览")]\n            }),\n            new docx.Paragraph({\n                children: [new docx.TextRun("以下是本年度数据汇总。")]\n            })\n        ]\n    }]\n});',
        validate: function(xml) {
            return [
                { pass: xml.indexOf('年度数据报告') !== -1, msg: '包含文本 "年度数据报告"' },
                { pass: /<w:pStyle w:val="Heading1"/.test(xml), msg: '使用了一级标题样式' },
                { pass: xml.indexOf('数据概览') !== -1, msg: '包含文本 "数据概览"' },
                { pass: /<w:pStyle w:val="Heading2"/.test(xml), msg: '使用了二级标题样式' },
                { pass: xml.indexOf('以下是本年度数据汇总') !== -1, msg: '包含正文文本' }
            ];
        }
    },
    {
        id: 8,
        title: '项目符号列表',
        description: '创建带有项目符号的列表',
        tutorial: '\
            <p>通过 <code>bullet</code> 属性可以创建项目符号列表（无序列表）：</p>\
            <div class="syntax-block">new docx.Paragraph({\n\
    bullet: { level: 0 },\n\
    children: [new docx.TextRun("列表项1")]\n\
})\n\
\n\
new docx.Paragraph({\n\
    bullet: { level: 0 },\n\
    children: [new docx.TextRun("列表项2")]\n\
})</div>\
            <p><code>level</code> 控制缩进层级：<code>0</code> 是一级列表，<code>1</code> 是二级（子列表），以此类推。</p>\
            <p>每个列表项就是一个设置了 <code>bullet</code> 的段落，非常直观。</p>\
        ',
        task: '创建文档，包含一个三项的项目符号列表，内容分别为：<code>"数据收集"</code>、<code>"数据清洗"</code>、<code>"数据分析"</code>。全部为一级（level: 0）。赋值给 <code>result</code>。',
        hint: '每个段落都加上 bullet: { level: 0 }',
        setupCode: '',
        previewData: null,
        answer: 'var result = new docx.Document({\n    sections: [{\n        children: [\n            new docx.Paragraph({\n                bullet: { level: 0 },\n                children: [new docx.TextRun("数据收集")]\n            }),\n            new docx.Paragraph({\n                bullet: { level: 0 },\n                children: [new docx.TextRun("数据清洗")]\n            }),\n            new docx.Paragraph({\n                bullet: { level: 0 },\n                children: [new docx.TextRun("数据分析")]\n            })\n        ]\n    }]\n});',
        validate: function(xml) {
            return [
                { pass: xml.indexOf('数据收集') !== -1, msg: '包含文本 "数据收集"' },
                { pass: xml.indexOf('数据清洗') !== -1, msg: '包含文本 "数据清洗"' },
                { pass: xml.indexOf('数据分析') !== -1, msg: '包含文本 "数据分析"' },
                { pass: (xml.match(/<w:numId /g) || []).length >= 3, msg: '三个段落都设置了项目符号' }
            ];
        }
    },

    // ===== 第四阶段：表格 =====
    {
        id: 9,
        title: '创建表格',
        description: '用 Table 组件创建数据表格',
        tutorial: '\
            <p>表格由三层嵌套构成：<code>Table</code> → <code>TableRow</code> → <code>TableCell</code>：</p>\
            <div class="syntax-block">new docx.Table({\n\
    rows: [\n\
        new docx.TableRow({\n\
            children: [\n\
                new docx.TableCell({\n\
                    children: [new docx.Paragraph("单元格1")]\n\
                }),\n\
                new docx.TableCell({\n\
                    children: [new docx.Paragraph("单元格2")]\n\
                })\n\
            ]\n\
        })\n\
    ]\n\
})</div>\
            <p>注意：<code>TableCell</code> 的 <code>children</code> 必须是 <code>Paragraph</code>，不能直接放文字。</p>\
            <p>小技巧：<code>new docx.Paragraph("文本")</code> 是简写形式，等价于包含一个 TextRun 的 Paragraph。</p>\
        ',
        task: '创建文档，包含一个 2行×3列 的表格。第一行（表头）为 <code>"姓名"</code>、<code>"部门"</code>、<code>"工资"</code>；第二行为 <code>"张三"</code>、<code>"技术部"</code>、<code>"12000"</code>。赋值给 <code>result</code>。',
        hint: '创建 Table，rows 中放两个 TableRow，每个 TableRow 的 children 中放三个 TableCell。',
        setupCode: '',
        previewData: null,
        answer: 'var result = new docx.Document({\n    sections: [{\n        children: [\n            new docx.Table({\n                rows: [\n                    new docx.TableRow({\n                        children: [\n                            new docx.TableCell({ children: [new docx.Paragraph("姓名")] }),\n                            new docx.TableCell({ children: [new docx.Paragraph("部门")] }),\n                            new docx.TableCell({ children: [new docx.Paragraph("工资")] })\n                        ]\n                    }),\n                    new docx.TableRow({\n                        children: [\n                            new docx.TableCell({ children: [new docx.Paragraph("张三")] }),\n                            new docx.TableCell({ children: [new docx.Paragraph("技术部")] }),\n                            new docx.TableCell({ children: [new docx.Paragraph("12000")] })\n                        ]\n                    })\n                ]\n            })\n        ]\n    }]\n});',
        validate: function(xml) {
            return [
                { pass: /<w:tbl>/.test(xml), msg: '文档包含表格' },
                { pass: (xml.match(/<w:tr[ >]/g) || []).length >= 2, msg: '表格包含至少2行' },
                { pass: xml.indexOf('姓名') !== -1, msg: '表头包含 "姓名"' },
                { pass: xml.indexOf('部门') !== -1, msg: '表头包含 "部门"' },
                { pass: xml.indexOf('工资') !== -1, msg: '表头包含 "工资"' },
                { pass: xml.indexOf('张三') !== -1, msg: '数据行包含 "张三"' },
                { pass: xml.indexOf('技术部') !== -1, msg: '数据行包含 "技术部"' },
                { pass: xml.indexOf('12000') !== -1, msg: '数据行包含 "12000"' }
            ];
        }
    },
    {
        id: 10,
        title: '从数据生成表格',
        description: '用循环从 JSON 数据动态生成表格',
        tutorial: '\
            <p>实际数据工作中，数据通常来自 JSON 数组。我们可以用 <code>map</code> 循环生成表格行：</p>\
            <div class="syntax-block">// 假设 data 是 JSON 数组\n\
var headerRow = new docx.TableRow({\n\
    children: ["姓名", "部门"].map(function(h) {\n\
        return new docx.TableCell({\n\
            children: [new docx.Paragraph(h)]\n\
        });\n\
    })\n\
});\n\
\n\
var dataRows = data.map(function(item) {\n\
    return new docx.TableRow({\n\
        children: [\n\
            new docx.TableCell({ children: [new docx.Paragraph(item.姓名)] }),\n\
            new docx.TableCell({ children: [new docx.Paragraph(item.部门)] })\n\
        ]\n\
    });\n\
});\n\
\n\
new docx.Table({ rows: [headerRow].concat(dataRows) })</div>\
            <p>关键技巧：用 <code>[headerRow].concat(dataRows)</code> 将表头行和数据行合并。</p>\
            <p>注意：<code>Paragraph</code> 的参数必须是字符串，数字需用 <code>String()</code> 转换。</p>\
        ',
        task: '已提供 <code>employees</code> 数组。请生成一个含表头（姓名、部门、工资）的完整表格文档，赋值给 <code>result</code>。',
        hint: '先创建 headerRow，再用 employees.map 创建 dataRows，最后 new docx.Table({ rows: [headerRow].concat(dataRows) })',
        setupCode: '\
            var employees = [\n\
                { 姓名: "张三", 部门: "技术部", 工资: 12000 },\n\
                { 姓名: "李四", 部门: "市场部", 工资: 15000 },\n\
                { 姓名: "王五", 部门: "人事部", 工资: 9000 },\n\
                { 姓名: "赵六", 部门: "技术部", 工资: 18000 }\n\
            ];\n\
        ',
        previewData: {
            label: '变量 employees（JSON 数组）',
            headers: ['姓名', '部门', '工资'],
            rows: [
                ['张三', '技术部', 12000],
                ['李四', '市场部', 15000],
                ['王五', '人事部', 9000],
                ['赵六', '技术部', 18000]
            ]
        },
        answer: 'var headerRow = new docx.TableRow({\n    children: ["姓名", "部门", "工资"].map(function(h) {\n        return new docx.TableCell({ children: [new docx.Paragraph(h)] });\n    })\n});\nvar dataRows = employees.map(function(emp) {\n    return new docx.TableRow({\n        children: [\n            new docx.TableCell({ children: [new docx.Paragraph(emp.姓名)] }),\n            new docx.TableCell({ children: [new docx.Paragraph(emp.部门)] }),\n            new docx.TableCell({ children: [new docx.Paragraph(String(emp.工资))] })\n        ]\n    });\n});\nvar result = new docx.Document({\n    sections: [{\n        children: [\n            new docx.Table({ rows: [headerRow].concat(dataRows) })\n        ]\n    }]\n});',
        validate: function(xml) {
            return [
                { pass: /<w:tbl>/.test(xml), msg: '文档包含表格' },
                { pass: (xml.match(/<w:tr[ >]/g) || []).length >= 5, msg: '表格包含5行（1表头+4数据）' },
                { pass: xml.indexOf('姓名') !== -1 && xml.indexOf('部门') !== -1 && xml.indexOf('工资') !== -1, msg: '表头包含 姓名、部门、工资' },
                { pass: xml.indexOf('张三') !== -1 && xml.indexOf('李四') !== -1, msg: '包含数据 张三、李四' },
                { pass: xml.indexOf('王五') !== -1 && xml.indexOf('赵六') !== -1, msg: '包含数据 王五、赵六' },
                { pass: xml.indexOf('12000') !== -1 && xml.indexOf('18000') !== -1, msg: '包含工资数据' }
            ];
        }
    },

    // ===== 第五阶段：综合应用 =====
    {
        id: 11,
        title: '混合排版文档',
        description: '组合标题、段落和表格',
        tutorial: '\
            <p>真实的 Word 文档通常包含多种元素的组合。在 <code>children</code> 数组中，可以<strong>自由混合</strong> Paragraph 和 Table：</p>\
            <div class="syntax-block">children: [\n\
    // 标题\n\
    new docx.Paragraph({\n\
        heading: docx.HeadingLevel.HEADING_1,\n\
        children: [new docx.TextRun("报告标题")]\n\
    }),\n\
    // 正文段落\n\
    new docx.Paragraph({\n\
        children: [new docx.TextRun("描述文字...")]\n\
    }),\n\
    // 数据表格\n\
    new docx.Table({ rows: [...] })\n\
]</div>\
            <p>就像在 Word 中依次输入标题、段落、插入表格一样自然。</p>\
        ',
        task: '创建文档，依次包含：①一级标题 <code>"员工信息表"</code>；②正文 <code>"以下是本部门员工列表："</code>；③一个2行×2列的表格，表头为 <code>"姓名"</code> 和 <code>"职位"</code>，数据行为 <code>"张三"</code> 和 <code>"工程师"</code>。赋值给 <code>result</code>。',
        hint: '按顺序在 children 中放入：Paragraph(heading H1)、Paragraph(正文)、Table(2行×2列)',
        setupCode: '',
        previewData: null,
        answer: 'var result = new docx.Document({\n    sections: [{\n        children: [\n            new docx.Paragraph({\n                heading: docx.HeadingLevel.HEADING_1,\n                children: [new docx.TextRun("员工信息表")]\n            }),\n            new docx.Paragraph({\n                children: [new docx.TextRun("以下是本部门员工列表：")]\n            }),\n            new docx.Table({\n                rows: [\n                    new docx.TableRow({\n                        children: [\n                            new docx.TableCell({ children: [new docx.Paragraph("姓名")] }),\n                            new docx.TableCell({ children: [new docx.Paragraph("职位")] })\n                        ]\n                    }),\n                    new docx.TableRow({\n                        children: [\n                            new docx.TableCell({ children: [new docx.Paragraph("张三")] }),\n                            new docx.TableCell({ children: [new docx.Paragraph("工程师")] })\n                        ]\n                    })\n                ]\n            })\n        ]\n    }]\n});',
        validate: function(xml) {
            return [
                { pass: /<w:pStyle w:val="Heading1"/.test(xml), msg: '包含一级标题' },
                { pass: xml.indexOf('员工信息表') !== -1, msg: '标题为 "员工信息表"' },
                { pass: xml.indexOf('以下是本部门员工列表') !== -1, msg: '包含描述段落' },
                { pass: /<w:tbl>/.test(xml), msg: '包含表格' },
                { pass: xml.indexOf('姓名') !== -1 && xml.indexOf('职位') !== -1, msg: '表头含 姓名、职位' },
                { pass: xml.indexOf('张三') !== -1 && xml.indexOf('工程师') !== -1, msg: '数据行含 张三、工程师' }
            ];
        }
    },
    {
        id: 12,
        title: '综合实战：数据报告',
        description: '从 JSON 数据生成完整的数据报告文档',
        tutorial: '\
            <p>现在来一次综合实战：从提供的 JSON 数据生成一份完整的数据报告。这是数据工作者最常见的场景——把分析结果自动化生成为 Word 文档。</p>\
            <p>你需要综合运用前面学到的所有技能：</p>\
            <ul style="margin:8px 0 8px 20px;line-height:2;">\
                <li>标题样式（<code>heading</code>）</li>\
                <li>文本格式（<code>bold</code>、<code>size</code>、<code>color</code>）</li>\
                <li>段落对齐（<code>alignment</code>）</li>\
                <li>从数据动态生成表格（<code>Table</code> + <code>map</code>）</li>\
            </ul>\
            <p>已提供变量 <code>report</code>，包含报告的标题、日期、摘要和数据。</p>\
        ',
        task: '根据 <code>report</code> 数据生成文档，要求包含：①居中的一级标题（report.title）；②右对齐的日期（report.date）；③正文摘要段落（report.summary）；④二级标题 <code>"详细数据"</code>；⑤从 report.data 生成的完整表格（含表头 姓名/部门/业绩）。赋值给 <code>result</code>。',
        hint: '按五个部分依次写入 children：\n1. Paragraph(heading H1, alignment CENTER, report.title)\n2. Paragraph(alignment RIGHT, report.date)\n3. Paragraph(report.summary)\n4. Paragraph(heading H2, "详细数据")\n5. Table(表头行 + report.data.map 生成数据行)',
        setupCode: '\
            var report = {\n\
                title: "2024年度销售报告",\n\
                date: "2024年12月31日",\n\
                summary: "本年度团队整体业绩优秀，多名员工超额完成目标。",\n\
                data: [\n\
                    { 姓名: "张三", 部门: "华东区", 业绩: 150 },\n\
                    { 姓名: "李四", 部门: "华南区", 业绩: 230 },\n\
                    { 姓名: "王五", 部门: "华北区", 业绩: 180 },\n\
                    { 姓名: "赵六", 部门: "西南区", 业绩: 120 }\n\
                ]\n\
            };\n\
        ',
        previewData: {
            label: '变量 report.data（JSON 数组）',
            headers: ['姓名', '部门', '业绩'],
            rows: [
                ['张三', '华东区', 150],
                ['李四', '华南区', 230],
                ['王五', '华北区', 180],
                ['赵六', '西南区', 120]
            ]
        },
        answer: 'var headerRow = new docx.TableRow({\n    children: ["姓名", "部门", "业绩"].map(function(h) {\n        return new docx.TableCell({ children: [new docx.Paragraph(h)] });\n    })\n});\nvar dataRows = report.data.map(function(item) {\n    return new docx.TableRow({\n        children: [\n            new docx.TableCell({ children: [new docx.Paragraph(item.姓名)] }),\n            new docx.TableCell({ children: [new docx.Paragraph(item.部门)] }),\n            new docx.TableCell({ children: [new docx.Paragraph(String(item.业绩))] })\n        ]\n    });\n});\nvar result = new docx.Document({\n    sections: [{\n        children: [\n            new docx.Paragraph({\n                heading: docx.HeadingLevel.HEADING_1,\n                alignment: docx.AlignmentType.CENTER,\n                children: [new docx.TextRun(report.title)]\n            }),\n            new docx.Paragraph({\n                alignment: docx.AlignmentType.RIGHT,\n                children: [new docx.TextRun(report.date)]\n            }),\n            new docx.Paragraph({\n                children: [new docx.TextRun(report.summary)]\n            }),\n            new docx.Paragraph({\n                heading: docx.HeadingLevel.HEADING_2,\n                children: [new docx.TextRun("详细数据")]\n            }),\n            new docx.Table({ rows: [headerRow].concat(dataRows) })\n        ]\n    }]\n});',
        validate: function(xml) {
            return [
                { pass: /<w:pStyle w:val="Heading1"/.test(xml), msg: '包含一级标题' },
                { pass: xml.indexOf('2024年度销售报告') !== -1, msg: '标题为报告标题' },
                { pass: /<w:jc w:val="center"/.test(xml), msg: '标题居中对齐' },
                { pass: xml.indexOf('2024年12月31日') !== -1, msg: '包含日期' },
                { pass: /<w:jc w:val="right"/.test(xml) || /<w:jc w:val="end"/.test(xml), msg: '日期右对齐' },
                { pass: xml.indexOf('本年度团队整体业绩优秀') !== -1, msg: '包含摘要段落' },
                { pass: /<w:pStyle w:val="Heading2"/.test(xml), msg: '包含二级标题' },
                { pass: xml.indexOf('详细数据') !== -1, msg: '二级标题为 "详细数据"' },
                { pass: /<w:tbl>/.test(xml), msg: '包含数据表格' },
                { pass: xml.indexOf('华东区') !== -1 && xml.indexOf('华南区') !== -1, msg: '表格包含所有数据' }
            ];
        }
    },

    // ===== 第六阶段：段落进阶 =====
    {
        id: 13,
        title: '段落缩进与行距',
        description: '设置首行缩进和行距，公文排版基础',
        tutorial: '\
            <p>公文正文要求<strong>首行缩进2字符</strong>、<strong>固定行距</strong>。docx 库通过 <code>indent</code> 和 <code>spacing</code> 实现：</p>\
            <div class="syntax-block">new docx.Paragraph({\n\
    indent: { firstLine: 480 },  // 首行缩进，单位 twip\n\
    spacing: { line: 560 },      // 行距，单位 twip\n\
    children: [new docx.TextRun("正文内容")]\n\
})</div>\
            <p><strong>twip 单位：</strong>1磅 = 20 twip。常用值：</p>\
            <ul style="margin:8px 0 8px 20px;line-height:2;">\
                <li>首行缩进2字符（三号字）≈ <code>480</code> twip</li>\
                <li>行距 28 磅（公文标准）= 28 × 20 = <code>560</code> twip</li>\
                <li>段前/段后 6 磅 = 6 × 20 = <code>120</code> twip</li>\
            </ul>\
            <p><code>spacing</code> 还支持 <code>before</code>（段前）和 <code>after</code>（段后）。</p>\
        ',
        task: '创建文档，包含两个段落：①<code>"根据上级部门工作要求，现将有关事项通知如下。"</code>；②<code>"各部门应高度重视，认真组织落实相关工作。"</code>。两个段落都设置 <code>firstLine: 480</code> 和 <code>line: 560</code>。赋值给 <code>result</code>。',
        hint: '每个 Paragraph 都加上：\nindent: { firstLine: 480 },\nspacing: { line: 560 }',
        setupCode: '',
        previewData: null,
        answer: 'var result = new docx.Document({\n    sections: [{\n        children: [\n            new docx.Paragraph({\n                indent: { firstLine: 480 },\n                spacing: { line: 560 },\n                children: [new docx.TextRun("根据上级部门工作要求，现将有关事项通知如下。")]\n            }),\n            new docx.Paragraph({\n                indent: { firstLine: 480 },\n                spacing: { line: 560 },\n                children: [new docx.TextRun("各部门应高度重视，认真组织落实相关工作。")]\n            })\n        ]\n    }]\n});',
        validate: function(xml) {
            return [
                { pass: xml.indexOf('根据上级部门工作要求') !== -1, msg: '包含第一段文本' },
                { pass: xml.indexOf('各部门应高度重视') !== -1, msg: '包含第二段文本' },
                { pass: /<w:ind[^>]*w:firstLine="480"/.test(xml), msg: '设置了首行缩进 480 twip' },
                { pass: /<w:spacing[^>]*w:line="560"/.test(xml), msg: '设置了行距 560 twip（28磅）' },
                { pass: (xml.match(/w:firstLine="480"/g) || []).length >= 2, msg: '两个段落都设置了缩进' }
            ];
        }
    },
    {
        id: 14,
        title: '公文页面设置',
        description: '设置 A4 纸张和标准公文边距',
        tutorial: '\
            <p>公文有严格的页面规范。通过 <code>section</code> 的 <code>properties</code> 设置页面：</p>\
            <div class="syntax-block">sections: [{\n\
    properties: {\n\
        page: {\n\
            size: {\n\
                width: docx.convertMillimetersToTwip(210),\n\
                height: docx.convertMillimetersToTwip(297)\n\
            },\n\
            margin: {\n\
                top: docx.convertMillimetersToTwip(37),\n\
                bottom: docx.convertMillimetersToTwip(35),\n\
                left: docx.convertMillimetersToTwip(28),\n\
                right: docx.convertMillimetersToTwip(26)\n\
            }\n\
        }\n\
    },\n\
    children: [...]\n\
}]</div>\
            <p><code>docx.convertMillimetersToTwip(mm)</code> 可以将毫米自动转换为 twip 单位，非常方便。</p>\
            <p><strong>国标公文页面规范（GB/T 9704）：</strong></p>\
            <ul style="margin:8px 0 8px 20px;line-height:2;">\
                <li>纸张：A4（210mm × 297mm）</li>\
                <li>上边距：37mm</li>\
                <li>下边距：35mm</li>\
                <li>左边距：28mm</li>\
                <li>右边距：26mm</li>\
            </ul>\
        ',
        task: '创建一个 A4 页面、符合国标公文边距的文档，正文写一段 <code>"本文件按照国标公文格式排版。"</code>。赋值给 <code>result</code>。',
        hint: '在 sections 的第一个元素中加 properties: { page: { size: {...}, margin: {...} } }\n用 docx.convertMillimetersToTwip() 转换所有毫米值',
        setupCode: '',
        previewData: null,
        answer: 'var result = new docx.Document({\n    sections: [{\n        properties: {\n            page: {\n                size: {\n                    width: docx.convertMillimetersToTwip(210),\n                    height: docx.convertMillimetersToTwip(297)\n                },\n                margin: {\n                    top: docx.convertMillimetersToTwip(37),\n                    bottom: docx.convertMillimetersToTwip(35),\n                    left: docx.convertMillimetersToTwip(28),\n                    right: docx.convertMillimetersToTwip(26)\n                }\n            }\n        },\n        children: [\n            new docx.Paragraph({\n                children: [new docx.TextRun("本文件按照国标公文格式排版。")]\n            })\n        ]\n    }]\n});',
        validate: function(xml) {
            var sizeMatch = /<w:pgSz[^>]*w:w="(\d+)"[^>]*w:h="(\d+)"/.exec(xml) || /<w:pgSz[^>]*w:h="(\d+)"[^>]*w:w="(\d+)"/.exec(xml);
            var w = 0, h = 0;
            if (sizeMatch) {
                var vals = [parseInt(sizeMatch[1]), parseInt(sizeMatch[2])];
                w = Math.min(vals[0], vals[1]);
                h = Math.max(vals[0], vals[1]);
                if (/<w:pgSz[^>]*w:w="(\d+)"/.exec(xml)) w = parseInt(/<w:pgSz[^>]*w:w="(\d+)"/.exec(xml)[1]);
                if (/<w:pgSz[^>]*w:h="(\d+)"/.exec(xml)) h = parseInt(/<w:pgSz[^>]*w:h="(\d+)"/.exec(xml)[1]);
            }
            var marginMatch = /<w:pgMar[^\/]*\/?>/.exec(xml) || [''];
            var marginStr = marginMatch[0];
            var topM = parseInt((/<w:pgMar[^>]*w:top="(\d+)"/.exec(xml) || [0,0])[1]);
            var leftM = parseInt((/<w:pgMar[^>]*w:left="(\d+)"/.exec(xml) || [0,0])[1]);
            return [
                { pass: xml.indexOf('本文件按照国标公文格式排版') !== -1, msg: '包含正文文本' },
                { pass: Math.abs(w - 11906) < 10, msg: '纸张宽度为 A4（210mm ≈ 11906 twip）' },
                { pass: Math.abs(h - 16838) < 10, msg: '纸张高度为 A4（297mm ≈ 16838 twip）' },
                { pass: Math.abs(topM - 2098) < 10, msg: '上边距 37mm（≈ 2098 twip）' },
                { pass: Math.abs(leftM - 1587) < 10, msg: '左边距 28mm（≈ 1587 twip）' }
            ];
        }
    },

    // ===== 第七阶段：公文格式实战 =====
    {
        id: 15,
        title: '红头公文标题',
        description: '制作标准红头文件的标题区域',
        tutorial: '\
            <p><strong>红头文件</strong>是最常见的公文形式。标题区由以下部分组成：</p>\
            <ul style="margin:8px 0 8px 20px;line-height:2;">\
                <li><strong>发文机关标志</strong>：红色、大号、加粗、居中（二号字 = size 44）</li>\
                <li><strong>分隔线</strong>：红色横线，用段落底部边框实现</li>\
                <li><strong>发文字号</strong>：居中、三号仿宋（size 32）</li>\
                <li><strong>公文标题</strong>：居中、二号加粗（size 44）</li>\
            </ul>\
            <p>段落边框语法：</p>\
            <div class="syntax-block">new docx.Paragraph({\n\
    border: {\n\
        bottom: {\n\
            style: docx.BorderStyle.SINGLE,\n\
            size: 6,\n\
            color: "FF0000"\n\
        }\n\
    }\n\
})</div>\
        ',
        task: '创建红头文件标题区，依次包含：①居中红色加粗的 <code>"XX市人民政府文件"</code>（size 44, color FF0000）；②一条红色分隔线（空段落+底部红色边框）；③居中的发文字号 <code>"X政发〔2024〕1号"</code>（size 32）；④居中加粗的标题 <code>"关于做好年度工作总结的通知"</code>（size 44）。赋值给 <code>result</code>。',
        hint: '四个段落依次放入 children：\n1. 发文机关标志：alignment CENTER, TextRun({ bold, size:44, color:"FF0000" })\n2. 分隔线：border: { bottom: { style: docx.BorderStyle.SINGLE, size: 6, color: "FF0000" } }\n3. 发文字号：alignment CENTER, TextRun({ size:32 })\n4. 公文标题：alignment CENTER, TextRun({ bold, size:44 })',
        setupCode: '',
        previewData: null,
        answer: 'var result = new docx.Document({\n    sections: [{\n        children: [\n            new docx.Paragraph({\n                alignment: docx.AlignmentType.CENTER,\n                children: [new docx.TextRun({\n                    text: "XX市人民政府文件",\n                    bold: true,\n                    size: 44,\n                    color: "FF0000"\n                })]\n            }),\n            new docx.Paragraph({\n                border: {\n                    bottom: {\n                        style: docx.BorderStyle.SINGLE,\n                        size: 6,\n                        color: "FF0000"\n                    }\n                }\n            }),\n            new docx.Paragraph({\n                alignment: docx.AlignmentType.CENTER,\n                spacing: { before: 200, after: 200 },\n                children: [new docx.TextRun({\n                    text: "X政发〔2024〕1号",\n                    size: 32\n                })]\n            }),\n            new docx.Paragraph({\n                alignment: docx.AlignmentType.CENTER,\n                children: [new docx.TextRun({\n                    text: "关于做好年度工作总结的通知",\n                    bold: true,\n                    size: 44\n                })]\n            })\n        ]\n    }]\n});',
        validate: function(xml) {
            var runs = extractRuns(xml);
            var headerRun = runs.find(function(r) { return r.text.indexOf('XX市人民政府文件') !== -1; });
            return [
                { pass: !!headerRun, msg: '包含发文机关标志 "XX市人民政府文件"' },
                { pass: headerRun && headerRun.bold, msg: '发文机关标志为加粗' },
                { pass: headerRun && headerRun.color && headerRun.color.toUpperCase() === 'FF0000', msg: '发文机关标志为红色' },
                { pass: headerRun && headerRun.size === '44', msg: '发文机关标志字号为 44（二号）' },
                { pass: /<w:bottom[^>]*w:color="FF0000"/.test(xml) || /<w:bottom[^>]*w:val="single"[^>]*/.test(xml), msg: '包含红色分隔线' },
                { pass: xml.indexOf('X政发〔2024〕1号') !== -1, msg: '包含发文字号' },
                { pass: xml.indexOf('关于做好年度工作总结的通知') !== -1, msg: '包含公文标题' },
                { pass: (xml.match(/<w:jc w:val="center"/g) || []).length >= 3, msg: '多处使用居中对齐' }
            ];
        }
    },
    {
        id: 16,
        title: '公文通知格式',
        description: '生成完整格式的公文通知',
        tutorial: '\
            <p>一份完整的<strong>公文通知</strong>包含以下要素（从上到下）：</p>\
            <ul style="margin:8px 0 8px 20px;line-height:2;">\
                <li><strong>标题</strong>：居中、二号加粗</li>\
                <li><strong>主送机关</strong>：顶格（左对齐）、三号仿宋</li>\
                <li><strong>正文</strong>：首行缩进2字符、三号仿宋、行距28磅</li>\
                <li><strong>发文机关署名</strong>：右对齐</li>\
                <li><strong>成文日期</strong>：右对齐</li>\
            </ul>\
            <p>综合运用前面学过的 <code>alignment</code>、<code>indent</code>、<code>spacing</code>、<code>bold</code>、<code>size</code> 来组装完整通知。</p>\
        ',
        task: '根据 <code>notice</code> 数据生成完整公文通知：①居中加粗标题（size 44）；②左对齐主送机关（size 32）；③首行缩进正文段落（每段 indent firstLine 480, spacing line 560, size 32）；④右对齐发文机关；⑤右对齐日期。赋值给 <code>result</code>。',
        hint: '按5个部分依次写入 children：\n1. 标题：alignment CENTER, bold, size 44\n2. 主送机关：size 32\n3. 正文各段：indent firstLine 480, spacing line 560, size 32\n4. 发文机关：alignment RIGHT\n5. 日期：alignment RIGHT',
        setupCode: '\
            var notice = {\n\
                title: "关于开展数据质量专项检查的通知",\n\
                addressee: "各部门、各直属单位：",\n\
                body: [\n\
                    "为进一步提升数据管理水平，确保数据资产的准确性和完整性，经研究决定在全公司范围内开展数据质量专项检查工作。",\n\
                    "各部门应按照要求，对本部门管理的数据进行全面自查，形成自查报告，于2024年6月30日前报送数据管理中心。",\n\
                    "请各部门高度重视，精心组织，确保检查工作取得实效。"\n\
                ],\n\
                sender: "XX公司数据管理中心",\n\
                date: "2024年5月15日"\n\
            };\n\
        ',
        previewData: null,
        answer: 'var bodyParas = notice.body.map(function(text) {\n    return new docx.Paragraph({\n        indent: { firstLine: 480 },\n        spacing: { line: 560 },\n        children: [new docx.TextRun({ text: text, size: 32 })]\n    });\n});\nvar result = new docx.Document({\n    sections: [{\n        children: [\n            new docx.Paragraph({\n                alignment: docx.AlignmentType.CENTER,\n                spacing: { after: 200 },\n                children: [new docx.TextRun({ text: notice.title, bold: true, size: 44 })]\n            }),\n            new docx.Paragraph({\n                children: [new docx.TextRun({ text: notice.addressee, size: 32 })]\n            })\n        ].concat(bodyParas).concat([\n            new docx.Paragraph({\n                alignment: docx.AlignmentType.RIGHT,\n                spacing: { before: 400 },\n                children: [new docx.TextRun({ text: notice.sender, size: 32 })]\n            }),\n            new docx.Paragraph({\n                alignment: docx.AlignmentType.RIGHT,\n                children: [new docx.TextRun({ text: notice.date, size: 32 })]\n            })\n        ])\n    }]\n});',
        validate: function(xml) {
            return [
                { pass: xml.indexOf('关于开展数据质量专项检查的通知') !== -1, msg: '包含通知标题' },
                { pass: /<w:jc w:val="center"/.test(xml), msg: '标题居中对齐' },
                { pass: xml.indexOf('各部门、各直属单位') !== -1, msg: '包含主送机关' },
                { pass: xml.indexOf('为进一步提升数据管理水平') !== -1, msg: '包含正文第一段' },
                { pass: xml.indexOf('各部门应按照要求') !== -1, msg: '包含正文第二段' },
                { pass: xml.indexOf('请各部门高度重视') !== -1, msg: '包含正文第三段' },
                { pass: /<w:ind[^>]*w:firstLine="480"/.test(xml), msg: '正文设置了首行缩进' },
                { pass: /<w:spacing[^>]*w:line="560"/.test(xml), msg: '正文设置了行距 28 磅' },
                { pass: xml.indexOf('XX公司数据管理中心') !== -1, msg: '包含发文机关署名' },
                { pass: xml.indexOf('2024年5月15日') !== -1, msg: '包含成文日期' },
                { pass: /<w:jc w:val="right"/.test(xml) || /<w:jc w:val="end"/.test(xml), msg: '署名和日期右对齐' }
            ];
        }
    },
    {
        id: 17,
        title: '公文函件格式',
        description: '生成标准公文"函"的格式',
        tutorial: '\
            <p><strong>"函"</strong>是平级机关之间往来的公文，格式与通知有所不同：</p>\
            <ul style="margin:8px 0 8px 20px;line-height:2;">\
                <li>标题含 <strong>"函"</strong> 字，如"关于XX事项的函"</li>\
                <li>发文字号使用 <strong>"函"</strong> 字，如"X函〔2024〕1号"</li>\
                <li>结构：发文字号 → 标题 → 主送机关 → 正文 → 结语"特此函达" → 落款</li>\
            </ul>\
            <p>函件通常有简短的<strong>结语</strong>，如 "特此函达"、"请予函复" 等，同样首行缩进。</p>\
        ',
        task: '根据 <code>letter</code> 数据生成公文函件：①居中的发文字号（size 32）；②居中加粗标题（size 44）；③左对齐主送机关（size 32）；④首行缩进正文（indent 480, spacing line 560, size 32）；⑤首行缩进结语（indent 480, size 32）；⑥右对齐发文机关和日期。赋值给 <code>result</code>。',
        hint: '按结构依次写入 children：\n1. letter.docNumber 居中\n2. letter.title 居中加粗\n3. letter.addressee 左对齐\n4. letter.body 各段首行缩进\n5. letter.closing 首行缩进\n6. letter.sender 和 letter.date 右对齐',
        setupCode: '\
            var letter = {\n\
                docNumber: "X数函〔2024〕15号",\n\
                title: "关于协助提供历史数据的函",\n\
                addressee: "XX市统计局：",\n\
                body: [\n\
                    "因工作需要，我单位正在开展全市数据资源普查项目，需要贵单位协助提供2020年至2023年的相关统计数据。",\n\
                    "请贵单位于2024年7月31日前将相关数据通过电子政务平台报送至我单位数据管理科。"\n\
                ],\n\
                closing: "特此函达，望予以支持配合。",\n\
                sender: "XX市大数据管理局",\n\
                date: "2024年6月20日"\n\
            };\n\
        ',
        previewData: null,
        answer: 'var bodyParas = letter.body.map(function(text) {\n    return new docx.Paragraph({\n        indent: { firstLine: 480 },\n        spacing: { line: 560 },\n        children: [new docx.TextRun({ text: text, size: 32 })]\n    });\n});\nvar result = new docx.Document({\n    sections: [{\n        children: [\n            new docx.Paragraph({\n                alignment: docx.AlignmentType.CENTER,\n                spacing: { after: 100 },\n                children: [new docx.TextRun({ text: letter.docNumber, size: 32 })]\n            }),\n            new docx.Paragraph({\n                alignment: docx.AlignmentType.CENTER,\n                spacing: { after: 200 },\n                children: [new docx.TextRun({ text: letter.title, bold: true, size: 44 })]\n            }),\n            new docx.Paragraph({\n                children: [new docx.TextRun({ text: letter.addressee, size: 32 })]\n            })\n        ].concat(bodyParas).concat([\n            new docx.Paragraph({\n                indent: { firstLine: 480 },\n                children: [new docx.TextRun({ text: letter.closing, size: 32 })]\n            }),\n            new docx.Paragraph({\n                alignment: docx.AlignmentType.RIGHT,\n                spacing: { before: 400 },\n                children: [new docx.TextRun({ text: letter.sender, size: 32 })]\n            }),\n            new docx.Paragraph({\n                alignment: docx.AlignmentType.RIGHT,\n                children: [new docx.TextRun({ text: letter.date, size: 32 })]\n            })\n        ])\n    }]\n});',
        validate: function(xml) {
            return [
                { pass: xml.indexOf('X数函〔2024〕15号') !== -1, msg: '包含发文字号' },
                { pass: xml.indexOf('关于协助提供历史数据的函') !== -1, msg: '包含函件标题' },
                { pass: xml.indexOf('XX市统计局') !== -1, msg: '包含主送机关' },
                { pass: xml.indexOf('因工作需要') !== -1, msg: '包含正文第一段' },
                { pass: xml.indexOf('请贵单位于') !== -1, msg: '包含正文第二段' },
                { pass: /<w:ind[^>]*w:firstLine="480"/.test(xml), msg: '正文设置了首行缩进' },
                { pass: xml.indexOf('特此函达') !== -1, msg: '包含结语 "特此函达"' },
                { pass: xml.indexOf('XX市大数据管理局') !== -1, msg: '包含落款单位' },
                { pass: xml.indexOf('2024年6月20日') !== -1, msg: '包含成文日期' },
                { pass: /<w:jc w:val="right"/.test(xml) || /<w:jc w:val="end"/.test(xml), msg: '落款右对齐' }
            ];
        }
    },
    {
        id: 18,
        title: '批量公文生成',
        description: '终极挑战：从数据批量生成多份公文',
        tutorial: '\
            <p>数据工作者最强大的能力是<strong>批量自动化</strong>。docx 的 <code>sections</code> 数组可以包含多个节，每个节默认从新页开始——正好用来批量生成公文。</p>\
            <div class="syntax-block">// 每个部门生成一个节（一页公文）\n\
var sections = data.map(function(dept) {\n\
    return {\n\
        children: [\n\
            // 该部门的公文内容...\n\
        ]\n\
    };\n\
});\n\
\n\
var result = new docx.Document({ sections: sections });</div>\
            <p>这样一个 Word 文件就包含了多份公文，每份独立一页，打印即可分发！</p>\
            <p>这就是用代码做数据工作的威力——用 <code>map</code> 循环替代重复劳动。</p>\
        ',
        task: '已提供 <code>departments</code> 数组（3个部门）。为每个部门生成一页通知：①居中加粗标题 <code>"关于提交月度数据报告的通知"</code>（size 44）；②主送机关为 <code>dept.name + "："</code>（size 32）；③首行缩进正文为 <code>"请贵部门于" + dept.deadline + "前提交" + dept.name + "的月度数据报告，共涉及" + dept.tableCount + "张数据表。"</code>（indent 480, size 32）；④右对齐落款 <code>"数据管理中心"</code>；⑤右对齐日期 <code>"2024年8月1日"</code>。用 <code>departments.map</code> 生成 sections 数组。赋值给 <code>result</code>。',
        hint: 'var sections = departments.map(function(dept) {\n    return {\n        children: [\n            // 标题段落\n            // 主送机关段落\n            // 正文段落\n            // 落款段落\n            // 日期段落\n        ]\n    };\n});\nvar result = new docx.Document({ sections: sections });',
        setupCode: '\
            var departments = [\n\
                { name: "技术部", deadline: "8月15日", tableCount: 12 },\n\
                { name: "市场部", deadline: "8月18日", tableCount: 8 },\n\
                { name: "人事部", deadline: "8月20日", tableCount: 5 }\n\
            ];\n\
        ',
        previewData: {
            label: '变量 departments（JSON 数组）',
            headers: ['name', 'deadline', 'tableCount'],
            rows: [
                ['技术部', '8月15日', 12],
                ['市场部', '8月18日', 8],
                ['人事部', '8月20日', 5]
            ]
        },
        answer: 'var sections = departments.map(function(dept) {\n    return {\n        children: [\n            new docx.Paragraph({\n                alignment: docx.AlignmentType.CENTER,\n                spacing: { after: 200 },\n                children: [new docx.TextRun({ text: "关于提交月度数据报告的通知", bold: true, size: 44 })]\n            }),\n            new docx.Paragraph({\n                children: [new docx.TextRun({ text: dept.name + "：", size: 32 })]\n            }),\n            new docx.Paragraph({\n                indent: { firstLine: 480 },\n                children: [new docx.TextRun({ text: "请贵部门于" + dept.deadline + "前提交" + dept.name + "的月度数据报告，共涉及" + dept.tableCount + "张数据表。", size: 32 })]\n            }),\n            new docx.Paragraph({\n                alignment: docx.AlignmentType.RIGHT,\n                spacing: { before: 400 },\n                children: [new docx.TextRun({ text: "数据管理中心", size: 32 })]\n            }),\n            new docx.Paragraph({\n                alignment: docx.AlignmentType.RIGHT,\n                children: [new docx.TextRun({ text: "2024年8月1日", size: 32 })]\n            })\n        ]\n    };\n});\nvar result = new docx.Document({ sections: sections });',
        validate: function(xml) {
            return [
                { pass: xml.indexOf('关于提交月度数据报告的通知') !== -1, msg: '包含通知标题' },
                { pass: xml.indexOf('技术部') !== -1, msg: '包含技术部通知' },
                { pass: xml.indexOf('市场部') !== -1, msg: '包含市场部通知' },
                { pass: xml.indexOf('人事部') !== -1, msg: '包含人事部通知' },
                { pass: xml.indexOf('8月15日') !== -1, msg: '技术部截止日期正确' },
                { pass: xml.indexOf('8月18日') !== -1, msg: '市场部截止日期正确' },
                { pass: xml.indexOf('12张数据表') !== -1, msg: '技术部表数正确' },
                { pass: xml.indexOf('5张数据表') !== -1, msg: '人事部表数正确' },
                { pass: xml.indexOf('数据管理中心') !== -1, msg: '包含落款' },
                { pass: xml.indexOf('2024年8月1日') !== -1, msg: '包含日期' },
                { pass: (xml.match(/<w:sectPr/g) || []).length >= 3, msg: '文档包含3个节（每部门一页）' }
            ];
        }
    }
];

// ===== XML 分析辅助函数 =====
function extractRuns(xml) {
    var runs = [];
    var runPattern = /<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g;
    var match;
    while ((match = runPattern.exec(xml)) !== null) {
        var runXml = match[1];
        var textPattern = /<w:t[^>]*>([^<]*)<\/w:t>/g;
        var texts = [];
        var tm;
        while ((tm = textPattern.exec(runXml)) !== null) {
            texts.push(tm[1]);
        }
        var text = texts.join('');
        if (text) {
            runs.push({
                text: text,
                bold: /<w:b[\s\/>]/.test(runXml) && !/<w:b w:val="(false|0)"/.test(runXml),
                italic: /<w:i[\s\/>]/.test(runXml) && !/<w:i w:val="(false|0)"/.test(runXml),
                size: (/<w:sz w:val="(\d+)"/.exec(runXml) || [null, null])[1],
                color: (/<w:color w:val="([^"]+)"/.exec(runXml) || [null, null])[1]
            });
        }
    }
    return runs;
}

function extractAllTexts(xml) {
    var texts = [];
    var pattern = /<w:t[^>]*>([^<]*)<\/w:t>/g;
    var match;
    while ((match = pattern.exec(xml)) !== null) {
        if (match[1]) texts.push(match[1]);
    }
    return texts;
}

// ===== 进度管理 =====
var STORAGE_KEY = 'word-learn-progress';
var currentLevelIdx = -1;
var lastBlob = null;

function getProgress() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch(e) {
        return {};
    }
}

function saveProgress(levelId) {
    var p = getProgress();
    p[levelId] = true;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
    renderLevelGrid();
}

function isLevelCompleted(levelId) {
    return !!getProgress()[levelId];
}

function isLevelUnlocked(idx) {
    if (idx === 0) return true;
    return isLevelCompleted(LEVELS[idx - 1].id);
}

function getCompletedCount() {
    var p = getProgress();
    return LEVELS.filter(function(l) { return p[l.id]; }).length;
}

// ===== 代码执行引擎 =====
function executeUserCode(userCode, setupCode) {
    try {
        var fullCode = (setupCode || '') + '\n' + userCode + '\nreturn typeof result !== "undefined" ? result : undefined;';
        var fn = new Function('docx', fullCode);
        var output = fn(docx);
        return { success: true, result: output };
    } catch(e) {
        return { success: false, error: e.message };
    }
}

// ===== 文档打包与 XML 提取 =====
async function packDocument(doc) {
    try {
        var blob = await docx.Packer.toBlob(doc);
        var zip = await JSZip.loadAsync(blob);
        var xmlFile = zip.file('word/document.xml');
        if (!xmlFile) {
            return { success: false, error: '无法读取文档内容' };
        }
        var xml = await xmlFile.async('string');
        return { success: true, xml: xml, blob: blob };
    } catch(e) {
        return { success: false, error: '文档打包失败：' + e.message };
    }
}

// ===== 文档内容预览 =====
function formatDocPreview(xml) {
    var html = '';
    var texts = extractAllTexts(xml);
    var hasTable = /<w:tbl>/.test(xml);
    var hasHeading1 = /<w:pStyle w:val="Heading1"/.test(xml);
    var hasHeading2 = /<w:pStyle w:val="Heading2"/.test(xml);
    var tableRowCount = (xml.match(/<w:tr[ >]/g) || []).length;

    html += '<div class="doc-structure">';
    html += '<div><span class="tag">📄 文档内容：</span></div>';

    if (texts.length > 0) {
        texts.forEach(function(t) {
            html += '<div class="node"><span class="text">' + escapeHtml(t) + '</span></div>';
        });
    }

    if (hasTable) {
        html += '<div class="node"><span class="tag">📊 表格</span> <span class="attr">(' + tableRowCount + ' 行)</span></div>';
    }

    if (hasHeading1) {
        html += '<div class="node"><span class="attr">✦ 使用了一级标题样式</span></div>';
    }
    if (hasHeading2) {
        html += '<div class="node"><span class="attr">✦ 使用了二级标题样式</span></div>';
    }

    html += '</div>';
    return html;
}

// ===== UI 渲染 =====
function goBack() {
    if (currentLevelIdx >= 0) {
        showLevelSelect();
    } else {
        window.location.href = '../../index.html';
    }
}

function showLevelSelect() {
    currentLevelIdx = -1;
    lastBlob = null;
    document.getElementById('levelSelect').style.display = '';
    document.getElementById('levelDetail').style.display = 'none';
    document.getElementById('appInfo').style.display = '';
    renderLevelGrid();
}

function renderLevelGrid() {
    var grid = document.getElementById('levelGrid');
    var completed = getCompletedCount();

    document.getElementById('totalProgress').style.width = (completed / LEVELS.length * 100) + '%';
    document.getElementById('progressText').textContent = '已完成 ' + completed + ' / ' + LEVELS.length + ' 关';

    grid.innerHTML = LEVELS.map(function(level, idx) {
        var done = isLevelCompleted(level.id);
        var unlocked = isLevelUnlocked(idx);
        var cls = 'level-card';
        if (done) cls += ' completed';
        if (!unlocked) cls += ' locked';
        return '<div class="' + cls + '" data-idx="' + idx + '">' +
            (!unlocked ? '<div class="lock-icon">🔒</div>' : '') +
            '<div class="level-number">第 ' + level.id + ' 关</div>' +
            '<div class="level-card-title">' + level.title + '</div>' +
            '<div class="level-card-desc">' + level.description + '</div>' +
        '</div>';
    }).join('');

    grid.querySelectorAll('.level-card:not(.locked)').forEach(function(card) {
        card.addEventListener('click', function() {
            openLevel(parseInt(card.dataset.idx));
        });
    });
}

function openLevel(idx) {
    currentLevelIdx = idx;
    lastBlob = null;
    var level = LEVELS[idx];

    document.getElementById('levelSelect').style.display = 'none';
    document.getElementById('levelDetail').style.display = '';
    document.getElementById('appInfo').style.display = 'none';

    document.getElementById('levelTitle').textContent = '第 ' + level.id + ' 关：' + level.title;
    document.getElementById('tutorialContent').innerHTML = level.tutorial;
    document.getElementById('taskContent').innerHTML = level.task;

    // 数据预览
    var dataSection = document.getElementById('dataSection');
    var dataPreview = document.getElementById('dataPreview');
    if (level.previewData) {
        dataSection.style.display = '';
        dataPreview.innerHTML = renderPreviewData(level.previewData);
    } else {
        dataSection.style.display = 'none';
        dataPreview.innerHTML = '';
    }

    // 编辑器和结果重置
    document.getElementById('codeEditor').value = '';
    document.getElementById('resultArea').innerHTML = '<p class="placeholder-text">运行代码后在此查看结果</p>';
    document.getElementById('hintBox').style.display = 'none';
    document.getElementById('expectedSection').style.display = 'none';
    document.getElementById('btnDownload').style.display = 'none';

    // 导航按钮
    document.getElementById('btnPrevLevel').disabled = (idx === 0);
    var nextUnlocked = idx + 1 < LEVELS.length && isLevelUnlocked(idx + 1);
    document.getElementById('btnNextLevel').disabled = !nextUnlocked;
}

function renderPreviewData(previewData) {
    return '<div class="data-label">' + previewData.label + '</div>' +
        buildHTMLTable(previewData.headers, previewData.rows, 'preview-table');
}

function buildHTMLTable(columns, rows, cls) {
    var html = '<table class="' + cls + '"><thead><tr>';
    columns.forEach(function(c) { html += '<th>' + c + '</th>'; });
    html += '</tr></thead><tbody>';
    rows.forEach(function(row) {
        html += '<tr>';
        row.forEach(function(v) { html += '<td>' + (v === null || v === undefined ? '' : v) + '</td>'; });
        html += '</tr>';
    });
    html += '</tbody></table>';
    return html;
}

function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

async function handleRun() {
    var level = LEVELS[currentLevelIdx];
    var code = document.getElementById('codeEditor').value.trim();
    if (!code) return;

    var resultArea = document.getElementById('resultArea');
    var btnDownload = document.getElementById('btnDownload');
    lastBlob = null;
    btnDownload.style.display = 'none';

    // 1. 执行用户代码
    resultArea.innerHTML = '<p class="placeholder-text">⏳ 正在执行...</p>';
    var execResult = executeUserCode(code, level.setupCode);

    if (!execResult.success) {
        resultArea.innerHTML = '<div class="error-msg">❌ 代码错误：' + escapeHtml(execResult.error) + '</div>';
        return;
    }

    if (!execResult.result || typeof execResult.result !== 'object') {
        resultArea.innerHTML = '<div class="error-msg">❌ result 未赋值或不是有效的 Document 对象。请确保将 new docx.Document({...}) 赋值给 result。</div>';
        return;
    }

    // 2. 打包文档并提取 XML
    resultArea.innerHTML = '<p class="placeholder-text">⏳ 正在生成文档...</p>';
    var packResult = await packDocument(execResult.result);

    if (!packResult.success) {
        resultArea.innerHTML = '<div class="error-msg">❌ ' + escapeHtml(packResult.error) + '</div>';
        return;
    }

    lastBlob = packResult.blob;
    btnDownload.style.display = '';

    // 3. 验证
    var checks = level.validate(packResult.xml);
    var allPass = checks.every(function(c) { return c.pass; });

    var checkHTML = '<ul class="check-list">';
    checks.forEach(function(c) {
        var cls = c.pass ? 'pass' : 'fail';
        var icon = c.pass ? '✅' : '❌';
        checkHTML += '<li class="' + cls + '"><span class="check-icon">' + icon + '</span>' + c.msg + '</li>';
    });
    checkHTML += '</ul>';

    // 4. 文档内容预览
    var previewHTML = formatDocPreview(packResult.xml);

    if (allPass) {
        resultArea.innerHTML = '<div class="success-msg">✅ 完全正确！所有检查点都通过了。</div>' + checkHTML +
            '<div style="margin-top:12px;">' + previewHTML + '</div>';
        document.getElementById('expectedSection').style.display = 'none';
        saveProgress(level.id);
        showSuccessModal(level);
    } else {
        var passCount = checks.filter(function(c) { return c.pass; }).length;
        resultArea.innerHTML = '<div class="fail-msg">⚠️ 通过 ' + passCount + '/' + checks.length + ' 项检查，请继续完善。</div>' +
            checkHTML + '<div style="margin-top:12px;">' + previewHTML + '</div>';
        var expectedSection = document.getElementById('expectedSection');
        expectedSection.style.display = '';
        document.getElementById('expectedArea').innerHTML = '<div class="answer-block">' + escapeHtml(level.answer) + '</div>';
    }
}

function handleDownload() {
    if (!lastBlob) return;
    var level = LEVELS[currentLevelIdx];
    var url = URL.createObjectURL(lastBlob);
    var a = document.createElement('a');
    a.href = url;
    a.download = '第' + level.id + '关_' + level.title + '.docx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
}

function showSuccessModal(level) {
    var modal = document.getElementById('successModal');
    var idx = LEVELS.indexOf(level);
    var isLast = idx === LEVELS.length - 1;

    document.getElementById('successMsg').textContent = isLast
        ? '你已完成全部关卡，Word 文档与公文生成技能已全面掌握！'
        : '你已掌握「' + level.title + '」，继续挑战下一关吧！';

    document.getElementById('btnNextFromModal').style.display = isLast ? 'none' : '';
    modal.style.display = 'flex';
}

function handleHint() {
    var level = LEVELS[currentLevelIdx];
    var box = document.getElementById('hintBox');
    box.textContent = level.hint;
    box.style.display = box.style.display === 'none' ? '' : 'none';
}

// ===== 事件绑定 =====
document.addEventListener('DOMContentLoaded', function() {
    showLevelSelect();

    document.getElementById('btnRun').addEventListener('click', handleRun);
    document.getElementById('btnHint').addEventListener('click', handleHint);
    document.getElementById('btnDownload').addEventListener('click', handleDownload);

    document.getElementById('btnPrevLevel').addEventListener('click', function() {
        if (currentLevelIdx > 0) openLevel(currentLevelIdx - 1);
    });

    document.getElementById('btnNextLevel').addEventListener('click', function() {
        if (currentLevelIdx < LEVELS.length - 1 && isLevelUnlocked(currentLevelIdx + 1)) {
            openLevel(currentLevelIdx + 1);
        }
    });

    document.getElementById('btnBackToList').addEventListener('click', function() {
        document.getElementById('successModal').style.display = 'none';
        showLevelSelect();
    });

    document.getElementById('btnNextFromModal').addEventListener('click', function() {
        document.getElementById('successModal').style.display = 'none';
        if (currentLevelIdx < LEVELS.length - 1) {
            openLevel(currentLevelIdx + 1);
        }
    });

    // Ctrl+Enter 运行
    document.getElementById('codeEditor').addEventListener('keydown', function(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            handleRun();
        }
        // Tab 缩进支持
        if (e.key === 'Tab') {
            e.preventDefault();
            var editor = e.target;
            var start = editor.selectionStart;
            var end = editor.selectionEnd;
            editor.value = editor.value.substring(0, start) + '    ' + editor.value.substring(end);
            editor.selectionStart = editor.selectionEnd = start + 4;
        }
    });
});
