// ===== 关卡数据 =====
const LEVELS = [
    {
        id: 1,
        title: '初识 SELECT',
        description: '学习最基础的查询语句',
        tutorial: `
            <p><code>SELECT</code> 是SQL中最常用的语句，用于从数据表中查询数据。</p>
            <p>最简单的用法是查询表中的所有数据：</p>
            <div class="syntax-block">SELECT * FROM 表名;</div>
            <p>其中 <code>*</code> 表示"所有列"，<code>FROM</code> 后面跟表名。</p>
        `,
        task: '请查询 <code>students</code> 表中的所有数据。',
        hint: '使用 SELECT * FROM students; 即可查询所有数据。',
        setupSQL: `
            CREATE TABLE students (
                id INTEGER PRIMARY KEY,
                name TEXT,
                age INTEGER,
                gender TEXT,
                score REAL
            );
            INSERT INTO students VALUES (1, '张三', 20, '男', 85.5);
            INSERT INTO students VALUES (2, '李四', 22, '女', 92.0);
            INSERT INTO students VALUES (3, '王五', 21, '男', 78.0);
            INSERT INTO students VALUES (4, '赵六', 23, '女', 95.5);
            INSERT INTO students VALUES (5, '孙七', 20, '女', 88.0);
        `,
        tables: [
            {
                name: 'students',
                columns: ['id', 'name', 'age', 'gender', 'score'],
                rows: [
                    [1, '张三', 20, '男', 85.5],
                    [2, '李四', 22, '女', 92.0],
                    [3, '王五', 21, '男', 78.0],
                    [4, '赵六', 23, '女', 95.5],
                    [5, '孙七', 20, '女', 88.0]
                ]
            }
        ],
        answerSQL: 'SELECT * FROM students;',
        validate(userCols, userRows, expectedCols, expectedRows) {
            return defaultValidate(userCols, userRows, expectedCols, expectedRows);
        }
    },
    {
        id: 2,
        title: '选择特定列',
        description: '学习如何只查询需要的列',
        tutorial: `
            <p>有时我们不需要所有列的数据，可以指定要查询的列名：</p>
            <div class="syntax-block">SELECT 列名1, 列名2 FROM 表名;</div>
            <p>多个列名之间用逗号 <code>,</code> 分隔。</p>
            <p>例如只查名字和年龄：<code>SELECT name, age FROM students;</code></p>
        `,
        task: '请查询 <code>students</code> 表中所有学生的 <code>name</code>（姓名）和 <code>score</code>（成绩）。',
        hint: '使用 SELECT name, score FROM students; 选择需要的两列。',
        setupSQL: `
            CREATE TABLE students (
                id INTEGER PRIMARY KEY,
                name TEXT,
                age INTEGER,
                gender TEXT,
                score REAL
            );
            INSERT INTO students VALUES (1, '张三', 20, '男', 85.5);
            INSERT INTO students VALUES (2, '李四', 22, '女', 92.0);
            INSERT INTO students VALUES (3, '王五', 21, '男', 78.0);
            INSERT INTO students VALUES (4, '赵六', 23, '女', 95.5);
            INSERT INTO students VALUES (5, '孙七', 20, '女', 88.0);
        `,
        tables: [
            {
                name: 'students',
                columns: ['id', 'name', 'age', 'gender', 'score'],
                rows: [
                    [1, '张三', 20, '男', 85.5],
                    [2, '李四', 22, '女', 92.0],
                    [3, '王五', 21, '男', 78.0],
                    [4, '赵六', 23, '女', 95.5],
                    [5, '孙七', 20, '女', 88.0]
                ]
            }
        ],
        answerSQL: 'SELECT name, score FROM students;',
        validate(userCols, userRows, expectedCols, expectedRows) {
            return defaultValidate(userCols, userRows, expectedCols, expectedRows);
        }
    },
    {
        id: 3,
        title: '条件查询 WHERE',
        description: '学习使用 WHERE 过滤数据',
        tutorial: `
            <p><code>WHERE</code> 子句用于筛选满足条件的行：</p>
            <div class="syntax-block">SELECT * FROM 表名 WHERE 条件;</div>
            <p>常用比较运算符：</p>
            <ul style="margin:8px 0 8px 20px;line-height:2;">
                <li><code>=</code> 等于</li>
                <li><code>></code> 大于，<code><</code> 小于</li>
                <li><code>>=</code> 大于等于，<code><=</code> 小于等于</li>
                <li><code>!=</code> 或 <code><></code> 不等于</li>
            </ul>
            <p>例如查询年龄大于21的学生：<code>SELECT * FROM students WHERE age > 21;</code></p>
        `,
        task: '请查询 <code>students</code> 表中成绩（<code>score</code>）大于等于 90 的学生的所有信息。',
        hint: '使用 WHERE score >= 90 来筛选成绩大于等于90的记录。',
        setupSQL: `
            CREATE TABLE students (
                id INTEGER PRIMARY KEY,
                name TEXT,
                age INTEGER,
                gender TEXT,
                score REAL
            );
            INSERT INTO students VALUES (1, '张三', 20, '男', 85.5);
            INSERT INTO students VALUES (2, '李四', 22, '女', 92.0);
            INSERT INTO students VALUES (3, '王五', 21, '男', 78.0);
            INSERT INTO students VALUES (4, '赵六', 23, '女', 95.5);
            INSERT INTO students VALUES (5, '孙七', 20, '女', 88.0);
        `,
        tables: [
            {
                name: 'students',
                columns: ['id', 'name', 'age', 'gender', 'score'],
                rows: [
                    [1, '张三', 20, '男', 85.5],
                    [2, '李四', 22, '女', 92.0],
                    [3, '王五', 21, '男', 78.0],
                    [4, '赵六', 23, '女', 95.5],
                    [5, '孙七', 20, '女', 88.0]
                ]
            }
        ],
        answerSQL: 'SELECT * FROM students WHERE score >= 90;',
        validate(userCols, userRows, expectedCols, expectedRows) {
            return defaultValidate(userCols, userRows, expectedCols, expectedRows);
        }
    },
    {
        id: 4,
        title: '多条件查询 AND / OR',
        description: '学习组合多个筛选条件',
        tutorial: `
            <p>可以使用 <code>AND</code> 和 <code>OR</code> 组合多个条件：</p>
            <div class="syntax-block">-- AND：所有条件都满足
SELECT * FROM 表名 WHERE 条件1 AND 条件2;

-- OR：满足任一条件
SELECT * FROM 表名 WHERE 条件1 OR 条件2;</div>
            <p>文本值需要用单引号包裹，例如 <code>gender = '女'</code>。</p>
        `,
        task: '请查询 <code>students</code> 表中性别为 <code>女</code> 并且成绩大于 90 的学生的所有信息。',
        hint: '使用 WHERE gender = \'女\' AND score > 90 组合两个条件。',
        setupSQL: `
            CREATE TABLE students (
                id INTEGER PRIMARY KEY,
                name TEXT,
                age INTEGER,
                gender TEXT,
                score REAL
            );
            INSERT INTO students VALUES (1, '张三', 20, '男', 85.5);
            INSERT INTO students VALUES (2, '李四', 22, '女', 92.0);
            INSERT INTO students VALUES (3, '王五', 21, '男', 78.0);
            INSERT INTO students VALUES (4, '赵六', 23, '女', 95.5);
            INSERT INTO students VALUES (5, '孙七', 20, '女', 88.0);
        `,
        tables: [
            {
                name: 'students',
                columns: ['id', 'name', 'age', 'gender', 'score'],
                rows: [
                    [1, '张三', 20, '男', 85.5],
                    [2, '李四', 22, '女', 92.0],
                    [3, '王五', 21, '男', 78.0],
                    [4, '赵六', 23, '女', 95.5],
                    [5, '孙七', 20, '女', 88.0]
                ]
            }
        ],
        answerSQL: "SELECT * FROM students WHERE gender = '女' AND score > 90;",
        validate(userCols, userRows, expectedCols, expectedRows) {
            return defaultValidate(userCols, userRows, expectedCols, expectedRows);
        }
    },
    {
        id: 5,
        title: '排序 ORDER BY',
        description: '学习对查询结果进行排序',
        tutorial: `
            <p><code>ORDER BY</code> 用于对结果排序：</p>
            <div class="syntax-block">SELECT * FROM 表名 ORDER BY 列名 ASC;   -- 升序（默认）
SELECT * FROM 表名 ORDER BY 列名 DESC;  -- 降序</div>
            <p><code>ASC</code> 代表升序（从小到大），<code>DESC</code> 代表降序（从大到小）。</p>
            <p>不写排序方向时默认为 <code>ASC</code> 升序。</p>
        `,
        task: '请查询 <code>students</code> 表中所有学生信息，按成绩（<code>score</code>）从高到低排序。',
        hint: '使用 ORDER BY score DESC 实现降序排列。',
        setupSQL: `
            CREATE TABLE students (
                id INTEGER PRIMARY KEY,
                name TEXT,
                age INTEGER,
                gender TEXT,
                score REAL
            );
            INSERT INTO students VALUES (1, '张三', 20, '男', 85.5);
            INSERT INTO students VALUES (2, '李四', 22, '女', 92.0);
            INSERT INTO students VALUES (3, '王五', 21, '男', 78.0);
            INSERT INTO students VALUES (4, '赵六', 23, '女', 95.5);
            INSERT INTO students VALUES (5, '孙七', 20, '女', 88.0);
        `,
        tables: [
            {
                name: 'students',
                columns: ['id', 'name', 'age', 'gender', 'score'],
                rows: [
                    [1, '张三', 20, '男', 85.5],
                    [2, '李四', 22, '女', 92.0],
                    [3, '王五', 21, '男', 78.0],
                    [4, '赵六', 23, '女', 95.5],
                    [5, '孙七', 20, '女', 88.0]
                ]
            }
        ],
        answerSQL: 'SELECT * FROM students ORDER BY score DESC;',
        validate(userCols, userRows, expectedCols, expectedRows) {
            return orderedValidate(userCols, userRows, expectedCols, expectedRows);
        }
    },
    {
        id: 6,
        title: 'LIMIT 限制结果',
        description: '学习限制返回的行数',
        tutorial: `
            <p><code>LIMIT</code> 用于限制查询返回的行数：</p>
            <div class="syntax-block">SELECT * FROM 表名 LIMIT 数量;</div>
            <p>常与 <code>ORDER BY</code> 搭配使用，例如查询成绩最高的3名学生：</p>
            <div class="syntax-block">SELECT * FROM students ORDER BY score DESC LIMIT 3;</div>
        `,
        task: '请查询 <code>students</code> 表中成绩最高的 <b>2</b> 名学生的所有信息。',
        hint: '先用 ORDER BY score DESC 排序，再用 LIMIT 2 限制数量。',
        setupSQL: `
            CREATE TABLE students (
                id INTEGER PRIMARY KEY,
                name TEXT,
                age INTEGER,
                gender TEXT,
                score REAL
            );
            INSERT INTO students VALUES (1, '张三', 20, '男', 85.5);
            INSERT INTO students VALUES (2, '李四', 22, '女', 92.0);
            INSERT INTO students VALUES (3, '王五', 21, '男', 78.0);
            INSERT INTO students VALUES (4, '赵六', 23, '女', 95.5);
            INSERT INTO students VALUES (5, '孙七', 20, '女', 88.0);
        `,
        tables: [
            {
                name: 'students',
                columns: ['id', 'name', 'age', 'gender', 'score'],
                rows: [
                    [1, '张三', 20, '男', 85.5],
                    [2, '李四', 22, '女', 92.0],
                    [3, '王五', 21, '男', 78.0],
                    [4, '赵六', 23, '女', 95.5],
                    [5, '孙七', 20, '女', 88.0]
                ]
            }
        ],
        answerSQL: 'SELECT * FROM students ORDER BY score DESC LIMIT 2;',
        validate(userCols, userRows, expectedCols, expectedRows) {
            return orderedValidate(userCols, userRows, expectedCols, expectedRows);
        }
    },
    {
        id: 7,
        title: '别名 AS',
        description: '学习给列和表起别名',
        tutorial: `
            <p><code>AS</code> 关键字可以给列或表起一个别名，让结果更易读：</p>
            <div class="syntax-block">SELECT 列名 AS 别名 FROM 表名;
SELECT name AS 姓名, score AS 成绩 FROM students;</div>
            <p>别名不会改变原始数据，只影响查询结果的显示。</p>
        `,
        task: '请查询 <code>students</code> 表，将 <code>name</code> 显示为 <code>姓名</code>，<code>score</code> 显示为 <code>成绩</code>。',
        hint: '使用 SELECT name AS 姓名, score AS 成绩 FROM students;',
        setupSQL: `
            CREATE TABLE students (
                id INTEGER PRIMARY KEY,
                name TEXT,
                age INTEGER,
                gender TEXT,
                score REAL
            );
            INSERT INTO students VALUES (1, '张三', 20, '男', 85.5);
            INSERT INTO students VALUES (2, '李四', 22, '女', 92.0);
            INSERT INTO students VALUES (3, '王五', 21, '男', 78.0);
            INSERT INTO students VALUES (4, '赵六', 23, '女', 95.5);
            INSERT INTO students VALUES (5, '孙七', 20, '女', 88.0);
        `,
        tables: [
            {
                name: 'students',
                columns: ['id', 'name', 'age', 'gender', 'score'],
                rows: [
                    [1, '张三', 20, '男', 85.5],
                    [2, '李四', 22, '女', 92.0],
                    [3, '王五', 21, '男', 78.0],
                    [4, '赵六', 23, '女', 95.5],
                    [5, '孙七', 20, '女', 88.0]
                ]
            }
        ],
        answerSQL: 'SELECT name AS 姓名, score AS 成绩 FROM students;',
        validate(userCols, userRows, expectedCols, expectedRows) {
            return defaultValidate(userCols, userRows, expectedCols, expectedRows);
        }
    },
    {
        id: 8,
        title: 'DISTINCT 去重',
        description: '学习去除重复的查询结果',
        tutorial: `
            <p><code>DISTINCT</code> 关键字用于去除结果中的重复行：</p>
            <div class="syntax-block">SELECT DISTINCT 列名 FROM 表名;</div>
            <p>例如查看有哪些不同的年龄：<code>SELECT DISTINCT age FROM students;</code></p>
        `,
        task: '请查询 <code>students</code> 表中所有不重复的年龄（<code>age</code>）值。',
        hint: '使用 SELECT DISTINCT age FROM students;',
        setupSQL: `
            CREATE TABLE students (
                id INTEGER PRIMARY KEY,
                name TEXT,
                age INTEGER,
                gender TEXT,
                score REAL
            );
            INSERT INTO students VALUES (1, '张三', 20, '男', 85.5);
            INSERT INTO students VALUES (2, '李四', 22, '女', 92.0);
            INSERT INTO students VALUES (3, '王五', 21, '男', 78.0);
            INSERT INTO students VALUES (4, '赵六', 23, '女', 95.5);
            INSERT INTO students VALUES (5, '孙七', 20, '女', 88.0);
        `,
        tables: [
            {
                name: 'students',
                columns: ['id', 'name', 'age', 'gender', 'score'],
                rows: [
                    [1, '张三', 20, '男', 85.5],
                    [2, '李四', 22, '女', 92.0],
                    [3, '王五', 21, '男', 78.0],
                    [4, '赵六', 23, '女', 95.5],
                    [5, '孙七', 20, '女', 88.0]
                ]
            }
        ],
        answerSQL: 'SELECT DISTINCT age FROM students;',
        validate(userCols, userRows, expectedCols, expectedRows) {
            return setValidate(userCols, userRows, expectedCols, expectedRows);
        }
    },
    {
        id: 9,
        title: 'LIKE 模糊查询',
        description: '学习使用通配符进行模糊匹配',
        tutorial: `
            <p><code>LIKE</code> 用于模糊匹配文本，搭配通配符使用：</p>
            <div class="syntax-block">%  匹配任意数量的字符（包括零个）
_  匹配恰好一个字符

SELECT * FROM 表名 WHERE 列名 LIKE '模式';</div>
            <p>示例：</p>
            <ul style="margin:8px 0 8px 20px;line-height:2;">
                <li><code>LIKE '张%'</code> — 以"张"开头</li>
                <li><code>LIKE '%三'</code> — 以"三"结尾</li>
                <li><code>LIKE '%王%'</code> — 包含"王"</li>
            </ul>
        `,
        task: '请查询 <code>employees</code> 表中姓名（<code>name</code>）以"张"开头的所有员工信息。',
        hint: "使用 WHERE name LIKE '张%' 匹配以张开头的名字。",
        setupSQL: `
            CREATE TABLE employees (
                id INTEGER PRIMARY KEY,
                name TEXT,
                department TEXT,
                salary REAL
            );
            INSERT INTO employees VALUES (1, '张伟', '技术部', 15000);
            INSERT INTO employees VALUES (2, '李娜', '市场部', 12000);
            INSERT INTO employees VALUES (3, '张敏', '技术部', 16000);
            INSERT INTO employees VALUES (4, '王芳', '人事部', 11000);
            INSERT INTO employees VALUES (5, '张强', '市场部', 13000);
            INSERT INTO employees VALUES (6, '刘洋', '技术部', 14500);
        `,
        tables: [
            {
                name: 'employees',
                columns: ['id', 'name', 'department', 'salary'],
                rows: [
                    [1, '张伟', '技术部', 15000],
                    [2, '李娜', '市场部', 12000],
                    [3, '张敏', '技术部', 16000],
                    [4, '王芳', '人事部', 11000],
                    [5, '张强', '市场部', 13000],
                    [6, '刘洋', '技术部', 14500]
                ]
            }
        ],
        answerSQL: "SELECT * FROM employees WHERE name LIKE '张%';",
        validate(userCols, userRows, expectedCols, expectedRows) {
            return defaultValidate(userCols, userRows, expectedCols, expectedRows);
        }
    },
    {
        id: 10,
        title: '聚合函数 COUNT',
        description: '学习统计行数',
        tutorial: `
            <p>聚合函数用于对一组数据进行计算，<code>COUNT</code> 用于统计行数：</p>
            <div class="syntax-block">SELECT COUNT(*) FROM 表名;           -- 统计总行数
SELECT COUNT(*) FROM 表名 WHERE 条件;  -- 统计满足条件的行数</div>
            <p>其他常用聚合函数：<code>SUM</code>（求和）、<code>AVG</code>（平均值）、<code>MAX</code>（最大值）、<code>MIN</code>（最小值）。</p>
        `,
        task: '请统计 <code>employees</code> 表中技术部（<code>department = \'技术部\'</code>）的员工人数，结果列名为 <code>技术部人数</code>。',
        hint: "使用 SELECT COUNT(*) AS 技术部人数 FROM employees WHERE department = '技术部';",
        setupSQL: `
            CREATE TABLE employees (
                id INTEGER PRIMARY KEY,
                name TEXT,
                department TEXT,
                salary REAL
            );
            INSERT INTO employees VALUES (1, '张伟', '技术部', 15000);
            INSERT INTO employees VALUES (2, '李娜', '市场部', 12000);
            INSERT INTO employees VALUES (3, '张敏', '技术部', 16000);
            INSERT INTO employees VALUES (4, '王芳', '人事部', 11000);
            INSERT INTO employees VALUES (5, '张强', '市场部', 13000);
            INSERT INTO employees VALUES (6, '刘洋', '技术部', 14500);
        `,
        tables: [
            {
                name: 'employees',
                columns: ['id', 'name', 'department', 'salary'],
                rows: [
                    [1, '张伟', '技术部', 15000],
                    [2, '李娜', '市场部', 12000],
                    [3, '张敏', '技术部', 16000],
                    [4, '王芳', '人事部', 11000],
                    [5, '张强', '市场部', 13000],
                    [6, '刘洋', '技术部', 14500]
                ]
            }
        ],
        answerSQL: "SELECT COUNT(*) AS 技术部人数 FROM employees WHERE department = '技术部';",
        validate(userCols, userRows, expectedCols, expectedRows) {
            return defaultValidate(userCols, userRows, expectedCols, expectedRows);
        }
    },
    {
        id: 11,
        title: '聚合函数 SUM / AVG',
        description: '学习求和与求平均值',
        tutorial: `
            <p><code>SUM</code> 用于计算某列的总和，<code>AVG</code> 用于计算平均值：</p>
            <div class="syntax-block">SELECT SUM(列名) FROM 表名;
SELECT AVG(列名) FROM 表名;</div>
            <p>可以同时使用多个聚合函数，并用 <code>AS</code> 起别名：</p>
            <div class="syntax-block">SELECT SUM(salary) AS 总薪资, AVG(salary) AS 平均薪资
FROM employees;</div>
        `,
        task: '请查询 <code>employees</code> 表中所有员工的薪资总和（列名为 <code>总薪资</code>）和平均薪资（列名为 <code>平均薪资</code>）。',
        hint: '使用 SELECT SUM(salary) AS 总薪资, AVG(salary) AS 平均薪资 FROM employees;',
        setupSQL: `
            CREATE TABLE employees (id INTEGER PRIMARY KEY, name TEXT, department TEXT, salary REAL);
            INSERT INTO employees VALUES (1, '张伟', '技术部', 15000);
            INSERT INTO employees VALUES (2, '李娜', '市场部', 12000);
            INSERT INTO employees VALUES (3, '张敏', '技术部', 16000);
            INSERT INTO employees VALUES (4, '王芳', '人事部', 11000);
            INSERT INTO employees VALUES (5, '张强', '市场部', 13000);
            INSERT INTO employees VALUES (6, '刘洋', '技术部', 14500);
        `,
        tables: [{
            name: 'employees',
            columns: ['id', 'name', 'department', 'salary'],
            rows: [
                [1, '张伟', '技术部', 15000], [2, '李娜', '市场部', 12000],
                [3, '张敏', '技术部', 16000], [4, '王芳', '人事部', 11000],
                [5, '张强', '市场部', 13000], [6, '刘洋', '技术部', 14500]
            ]
        }],
        answerSQL: 'SELECT SUM(salary) AS 总薪资, AVG(salary) AS 平均薪资 FROM employees;',
        validate(userCols, userRows, expectedCols, expectedRows) {
            return defaultValidate(userCols, userRows, expectedCols, expectedRows);
        }
    },
    {
        id: 12,
        title: '聚合函数 MAX / MIN',
        description: '学习求最大值与最小值',
        tutorial: `
            <p><code>MAX</code> 返回某列的最大值，<code>MIN</code> 返回最小值：</p>
            <div class="syntax-block">SELECT MAX(列名) FROM 表名;
SELECT MIN(列名) FROM 表名;</div>
            <p>聚合函数可以和 <code>WHERE</code> 搭配，只统计满足条件的数据：</p>
            <div class="syntax-block">SELECT MAX(salary) AS 最高薪资
FROM employees WHERE department = '技术部';</div>
        `,
        task: '请查询 <code>employees</code> 表中市场部（<code>department = \'市场部\'</code>）的最高薪资（列名 <code>最高薪资</code>）和最低薪资（列名 <code>最低薪资</code>）。',
        hint: "使用 SELECT MAX(salary) AS 最高薪资, MIN(salary) AS 最低薪资 FROM employees WHERE department = '市场部';",
        setupSQL: `
            CREATE TABLE employees (id INTEGER PRIMARY KEY, name TEXT, department TEXT, salary REAL);
            INSERT INTO employees VALUES (1, '张伟', '技术部', 15000);
            INSERT INTO employees VALUES (2, '李娜', '市场部', 12000);
            INSERT INTO employees VALUES (3, '张敏', '技术部', 16000);
            INSERT INTO employees VALUES (4, '王芳', '人事部', 11000);
            INSERT INTO employees VALUES (5, '张强', '市场部', 13000);
            INSERT INTO employees VALUES (6, '刘洋', '技术部', 14500);
        `,
        tables: [{
            name: 'employees',
            columns: ['id', 'name', 'department', 'salary'],
            rows: [
                [1, '张伟', '技术部', 15000], [2, '李娜', '市场部', 12000],
                [3, '张敏', '技术部', 16000], [4, '王芳', '人事部', 11000],
                [5, '张强', '市场部', 13000], [6, '刘洋', '技术部', 14500]
            ]
        }],
        answerSQL: "SELECT MAX(salary) AS 最高薪资, MIN(salary) AS 最低薪资 FROM employees WHERE department = '市场部';",
        validate(userCols, userRows, expectedCols, expectedRows) {
            return defaultValidate(userCols, userRows, expectedCols, expectedRows);
        }
    },
    {
        id: 13,
        title: 'GROUP BY 分组',
        description: '学习按列分组统计',
        tutorial: `
            <p><code>GROUP BY</code> 将数据按某列的值分组，通常与聚合函数搭配使用：</p>
            <div class="syntax-block">SELECT 列名, 聚合函数(列名)
FROM 表名
GROUP BY 列名;</div>
            <p>例如统计每个部门的人数：</p>
            <div class="syntax-block">SELECT department, COUNT(*) AS 人数
FROM employees
GROUP BY department;</div>
        `,
        task: '请统计 <code>employees</code> 表中每个部门（<code>department</code>）的平均薪资，结果列名为 <code>department</code> 和 <code>平均薪资</code>。',
        hint: '使用 SELECT department, AVG(salary) AS 平均薪资 FROM employees GROUP BY department;',
        setupSQL: `
            CREATE TABLE employees (id INTEGER PRIMARY KEY, name TEXT, department TEXT, salary REAL);
            INSERT INTO employees VALUES (1, '张伟', '技术部', 15000);
            INSERT INTO employees VALUES (2, '李娜', '市场部', 12000);
            INSERT INTO employees VALUES (3, '张敏', '技术部', 16000);
            INSERT INTO employees VALUES (4, '王芳', '人事部', 11000);
            INSERT INTO employees VALUES (5, '张强', '市场部', 13000);
            INSERT INTO employees VALUES (6, '刘洋', '技术部', 14500);
        `,
        tables: [{
            name: 'employees',
            columns: ['id', 'name', 'department', 'salary'],
            rows: [
                [1, '张伟', '技术部', 15000], [2, '李娜', '市场部', 12000],
                [3, '张敏', '技术部', 16000], [4, '王芳', '人事部', 11000],
                [5, '张强', '市场部', 13000], [6, '刘洋', '技术部', 14500]
            ]
        }],
        answerSQL: 'SELECT department, AVG(salary) AS 平均薪资 FROM employees GROUP BY department;',
        validate(userCols, userRows, expectedCols, expectedRows) {
            return defaultValidate(userCols, userRows, expectedCols, expectedRows);
        }
    },
    {
        id: 14,
        title: 'HAVING 过滤分组',
        description: '学习对分组结果进行过滤',
        tutorial: `
            <p><code>HAVING</code> 用于过滤 <code>GROUP BY</code> 之后的分组结果：</p>
            <div class="syntax-block">SELECT 列名, 聚合函数(列名)
FROM 表名
GROUP BY 列名
HAVING 聚合条件;</div>
            <p><b>WHERE</b> 过滤的是原始行，<b>HAVING</b> 过滤的是分组后的结果。</p>
            <p>例如只显示人数大于2的部门：</p>
            <div class="syntax-block">SELECT department, COUNT(*) AS cnt
FROM employees
GROUP BY department
HAVING cnt > 2;</div>
        `,
        task: '请查询 <code>employees</code> 表中平均薪资大于 13000 的部门名称和平均薪资（列名 <code>avg_salary</code>）。',
        hint: '使用 GROUP BY department HAVING avg_salary > 13000，注意 HAVING 跟在 GROUP BY 后面。',
        setupSQL: `
            CREATE TABLE employees (id INTEGER PRIMARY KEY, name TEXT, department TEXT, salary REAL);
            INSERT INTO employees VALUES (1, '张伟', '技术部', 15000);
            INSERT INTO employees VALUES (2, '李娜', '市场部', 12000);
            INSERT INTO employees VALUES (3, '张敏', '技术部', 16000);
            INSERT INTO employees VALUES (4, '王芳', '人事部', 11000);
            INSERT INTO employees VALUES (5, '张强', '市场部', 13000);
            INSERT INTO employees VALUES (6, '刘洋', '技术部', 14500);
        `,
        tables: [{
            name: 'employees',
            columns: ['id', 'name', 'department', 'salary'],
            rows: [
                [1, '张伟', '技术部', 15000], [2, '李娜', '市场部', 12000],
                [3, '张敏', '技术部', 16000], [4, '王芳', '人事部', 11000],
                [5, '张强', '市场部', 13000], [6, '刘洋', '技术部', 14500]
            ]
        }],
        answerSQL: 'SELECT department, AVG(salary) AS avg_salary FROM employees GROUP BY department HAVING avg_salary > 13000;',
        validate(userCols, userRows, expectedCols, expectedRows) {
            return defaultValidate(userCols, userRows, expectedCols, expectedRows);
        }
    },
    {
        id: 15,
        title: 'IN 范围匹配',
        description: '学习用 IN 匹配多个值',
        tutorial: `
            <p><code>IN</code> 用于判断某列的值是否在一组值中：</p>
            <div class="syntax-block">SELECT * FROM 表名 WHERE 列名 IN (值1, 值2, 值3);</div>
            <p>等价于多个 <code>OR</code> 的简写：</p>
            <div class="syntax-block">-- 以下两种写法等价
WHERE department IN ('技术部', '市场部')
WHERE department = '技术部' OR department = '市场部'</div>
            <p><code>NOT IN</code> 则是排除这些值。</p>
        `,
        task: '请查询 <code>employees</code> 表中部门为"技术部"或"人事部"的所有员工信息（使用 <code>IN</code>）。',
        hint: "使用 WHERE department IN ('技术部', '人事部') 来匹配多个值。",
        setupSQL: `
            CREATE TABLE employees (id INTEGER PRIMARY KEY, name TEXT, department TEXT, salary REAL);
            INSERT INTO employees VALUES (1, '张伟', '技术部', 15000);
            INSERT INTO employees VALUES (2, '李娜', '市场部', 12000);
            INSERT INTO employees VALUES (3, '张敏', '技术部', 16000);
            INSERT INTO employees VALUES (4, '王芳', '人事部', 11000);
            INSERT INTO employees VALUES (5, '张强', '市场部', 13000);
            INSERT INTO employees VALUES (6, '刘洋', '技术部', 14500);
        `,
        tables: [{
            name: 'employees',
            columns: ['id', 'name', 'department', 'salary'],
            rows: [
                [1, '张伟', '技术部', 15000], [2, '李娜', '市场部', 12000],
                [3, '张敏', '技术部', 16000], [4, '王芳', '人事部', 11000],
                [5, '张强', '市场部', 13000], [6, '刘洋', '技术部', 14500]
            ]
        }],
        answerSQL: "SELECT * FROM employees WHERE department IN ('技术部', '人事部');",
        validate(userCols, userRows, expectedCols, expectedRows) {
            return defaultValidate(userCols, userRows, expectedCols, expectedRows);
        }
    },
    {
        id: 16,
        title: 'BETWEEN 区间查询',
        description: '学习查询某个范围内的数据',
        tutorial: `
            <p><code>BETWEEN</code> 用于查询某列值在指定范围内的行（包含两端）：</p>
            <div class="syntax-block">SELECT * FROM 表名 WHERE 列名 BETWEEN 最小值 AND 最大值;</div>
            <p>等价于：<code>WHERE 列名 >= 最小值 AND 列名 <= 最大值</code></p>
            <p><code>NOT BETWEEN</code> 则是查询范围之外的数据。</p>
        `,
        task: '请查询 <code>orders</code> 表中金额（<code>amount</code>）在 100 到 500 之间（含100和500）的所有订单。',
        hint: '使用 WHERE amount BETWEEN 100 AND 500 查询区间内的数据。',
        setupSQL: `
            CREATE TABLE orders (id INTEGER PRIMARY KEY, customer TEXT, product TEXT, amount REAL, order_date TEXT);
            INSERT INTO orders VALUES (1, '张三', '键盘', 299, '2025-01-15');
            INSERT INTO orders VALUES (2, '李四', '显示器', 1500, '2025-01-18');
            INSERT INTO orders VALUES (3, '王五', '鼠标', 89, '2025-02-01');
            INSERT INTO orders VALUES (4, '赵六', '耳机', 450, '2025-02-10');
            INSERT INTO orders VALUES (5, '孙七', '摄像头', 120, '2025-02-15');
            INSERT INTO orders VALUES (6, '张三', '音箱', 680, '2025-03-01');
        `,
        tables: [{
            name: 'orders',
            columns: ['id', 'customer', 'product', 'amount', 'order_date'],
            rows: [
                [1, '张三', '键盘', 299, '2025-01-15'],
                [2, '李四', '显示器', 1500, '2025-01-18'],
                [3, '王五', '鼠标', 89, '2025-02-01'],
                [4, '赵六', '耳机', 450, '2025-02-10'],
                [5, '孙七', '摄像头', 120, '2025-02-15'],
                [6, '张三', '音箱', 680, '2025-03-01']
            ]
        }],
        answerSQL: 'SELECT * FROM orders WHERE amount BETWEEN 100 AND 500;',
        validate(userCols, userRows, expectedCols, expectedRows) {
            return defaultValidate(userCols, userRows, expectedCols, expectedRows);
        }
    },
    {
        id: 17,
        title: 'NULL 空值处理',
        description: '学习处理空值数据',
        tutorial: `
            <p>数据库中 <code>NULL</code> 表示"没有值"，它不等于空字符串或0。</p>
            <p>判断空值必须用 <code>IS NULL</code> 或 <code>IS NOT NULL</code>：</p>
            <div class="syntax-block">SELECT * FROM 表名 WHERE 列名 IS NULL;      -- 值为空
SELECT * FROM 表名 WHERE 列名 IS NOT NULL;  -- 值不为空</div>
            <p>注意：<code>= NULL</code> 和 <code>!= NULL</code> 不会生效，必须用 <code>IS</code>。</p>
        `,
        task: '请查询 <code>students</code> 表中邮箱（<code>email</code>）为空的所有学生信息。',
        hint: '使用 WHERE email IS NULL 来查找空值记录。',
        setupSQL: `
            CREATE TABLE students (id INTEGER PRIMARY KEY, name TEXT, age INTEGER, email TEXT, score REAL);
            INSERT INTO students VALUES (1, '张三', 20, 'zhangsan@mail.com', 85);
            INSERT INTO students VALUES (2, '李四', 22, NULL, 92);
            INSERT INTO students VALUES (3, '王五', 21, 'wangwu@mail.com', 78);
            INSERT INTO students VALUES (4, '赵六', 23, NULL, 95);
            INSERT INTO students VALUES (5, '孙七', 20, 'sunqi@mail.com', NULL);
        `,
        tables: [{
            name: 'students',
            columns: ['id', 'name', 'age', 'email', 'score'],
            rows: [
                [1, '张三', 20, 'zhangsan@mail.com', 85],
                [2, '李四', 22, null, 92],
                [3, '王五', 21, 'wangwu@mail.com', 78],
                [4, '赵六', 23, null, 95],
                [5, '孙七', 20, 'sunqi@mail.com', null]
            ]
        }],
        answerSQL: 'SELECT * FROM students WHERE email IS NULL;',
        validate(userCols, userRows, expectedCols, expectedRows) {
            return defaultValidate(userCols, userRows, expectedCols, expectedRows);
        }
    },
    {
        id: 18,
        title: 'CASE WHEN 条件表达式',
        description: '学习在查询中使用条件判断',
        tutorial: `
            <p><code>CASE WHEN</code> 类似编程中的 if-else，可在查询中做条件判断：</p>
            <div class="syntax-block">SELECT name,
  CASE
    WHEN 条件1 THEN 结果1
    WHEN 条件2 THEN 结果2
    ELSE 默认结果
  END AS 别名
FROM 表名;</div>
            <p>例如根据成绩评级：</p>
            <div class="syntax-block">SELECT name,
  CASE
    WHEN score >= 90 THEN '优秀'
    WHEN score >= 80 THEN '良好'
    ELSE '一般'
  END AS 评级
FROM students;</div>
        `,
        task: '请查询 <code>employees</code> 表，输出 <code>name</code> 和 <code>薪资等级</code>：薪资>=15000为"高"，>=13000为"中"，其余为"低"。',
        hint: "使用 CASE WHEN salary >= 15000 THEN '高' WHEN salary >= 13000 THEN '中' ELSE '低' END AS 薪资等级",
        setupSQL: `
            CREATE TABLE employees (id INTEGER PRIMARY KEY, name TEXT, department TEXT, salary REAL);
            INSERT INTO employees VALUES (1, '张伟', '技术部', 15000);
            INSERT INTO employees VALUES (2, '李娜', '市场部', 12000);
            INSERT INTO employees VALUES (3, '张敏', '技术部', 16000);
            INSERT INTO employees VALUES (4, '王芳', '人事部', 11000);
            INSERT INTO employees VALUES (5, '张强', '市场部', 13000);
            INSERT INTO employees VALUES (6, '刘洋', '技术部', 14500);
        `,
        tables: [{
            name: 'employees',
            columns: ['id', 'name', 'department', 'salary'],
            rows: [
                [1, '张伟', '技术部', 15000], [2, '李娜', '市场部', 12000],
                [3, '张敏', '技术部', 16000], [4, '王芳', '人事部', 11000],
                [5, '张强', '市场部', 13000], [6, '刘洋', '技术部', 14500]
            ]
        }],
        answerSQL: "SELECT name, CASE WHEN salary >= 15000 THEN '高' WHEN salary >= 13000 THEN '中' ELSE '低' END AS 薪资等级 FROM employees;",
        validate(userCols, userRows, expectedCols, expectedRows) {
            return defaultValidate(userCols, userRows, expectedCols, expectedRows);
        }
    },
    {
        id: 19,
        title: '子查询（WHERE中）',
        description: '学习在条件中嵌套查询',
        tutorial: `
            <p>子查询是嵌套在另一个查询中的 <code>SELECT</code> 语句：</p>
            <div class="syntax-block">SELECT * FROM 表名
WHERE 列名 > (SELECT AVG(列名) FROM 表名);</div>
            <p>子查询用括号包裹，会先执行内层查询，再将结果用于外层。</p>
            <p>例如查找薪资高于平均值的员工：</p>
            <div class="syntax-block">SELECT * FROM employees
WHERE salary > (SELECT AVG(salary) FROM employees);</div>
        `,
        task: '请查询 <code>employees</code> 表中薪资高于全公司平均薪资的员工的 <code>name</code> 和 <code>salary</code>。',
        hint: '使用 WHERE salary > (SELECT AVG(salary) FROM employees) 作为子查询条件。',
        setupSQL: `
            CREATE TABLE employees (id INTEGER PRIMARY KEY, name TEXT, department TEXT, salary REAL);
            INSERT INTO employees VALUES (1, '张伟', '技术部', 15000);
            INSERT INTO employees VALUES (2, '李娜', '市场部', 12000);
            INSERT INTO employees VALUES (3, '张敏', '技术部', 16000);
            INSERT INTO employees VALUES (4, '王芳', '人事部', 11000);
            INSERT INTO employees VALUES (5, '张强', '市场部', 13000);
            INSERT INTO employees VALUES (6, '刘洋', '技术部', 14500);
        `,
        tables: [{
            name: 'employees',
            columns: ['id', 'name', 'department', 'salary'],
            rows: [
                [1, '张伟', '技术部', 15000], [2, '李娜', '市场部', 12000],
                [3, '张敏', '技术部', 16000], [4, '王芳', '人事部', 11000],
                [5, '张强', '市场部', 13000], [6, '刘洋', '技术部', 14500]
            ]
        }],
        answerSQL: 'SELECT name, salary FROM employees WHERE salary > (SELECT AVG(salary) FROM employees);',
        validate(userCols, userRows, expectedCols, expectedRows) {
            return defaultValidate(userCols, userRows, expectedCols, expectedRows);
        }
    },
    {
        id: 20,
        title: '子查询与 IN',
        description: '学习用子查询配合 IN 筛选',
        tutorial: `
            <p>子查询可以返回多行结果，配合 <code>IN</code> 使用：</p>
            <div class="syntax-block">SELECT * FROM 表A
WHERE 列名 IN (SELECT 列名 FROM 表B WHERE 条件);</div>
            <p>例如查找有订单的客户：</p>
            <div class="syntax-block">SELECT * FROM customers
WHERE id IN (SELECT customer_id FROM orders);</div>
        `,
        task: '请查询有下过订单的客户信息（<code>customers</code> 表中 <code>id</code> 出现在 <code>orders</code> 表的 <code>customer_id</code> 中的客户）。',
        hint: '使用 WHERE id IN (SELECT customer_id FROM orders) 筛选有订单的客户。',
        setupSQL: `
            CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, city TEXT);
            INSERT INTO customers VALUES (1, '张三', '北京');
            INSERT INTO customers VALUES (2, '李四', '上海');
            INSERT INTO customers VALUES (3, '王五', '广州');
            INSERT INTO customers VALUES (4, '赵六', '深圳');
            CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER, product TEXT, amount REAL);
            INSERT INTO orders VALUES (1, 1, '笔记本', 5999);
            INSERT INTO orders VALUES (2, 1, '鼠标', 199);
            INSERT INTO orders VALUES (3, 3, '键盘', 399);
        `,
        tables: [
            {
                name: 'customers',
                columns: ['id', 'name', 'city'],
                rows: [[1,'张三','北京'],[2,'李四','上海'],[3,'王五','广州'],[4,'赵六','深圳']]
            },
            {
                name: 'orders',
                columns: ['id', 'customer_id', 'product', 'amount'],
                rows: [[1,1,'笔记本',5999],[2,1,'鼠标',199],[3,3,'键盘',399]]
            }
        ],
        answerSQL: 'SELECT * FROM customers WHERE id IN (SELECT customer_id FROM orders);',
        validate(userCols, userRows, expectedCols, expectedRows) {
            return defaultValidate(userCols, userRows, expectedCols, expectedRows);
        }
    },
    {
        id: 21,
        title: 'INNER JOIN 内连接',
        description: '学习关联两张表查询',
        tutorial: `
            <p><code>INNER JOIN</code> 用于根据关联条件合并两张表的数据，只返回两表都匹配的行：</p>
            <div class="syntax-block">SELECT 表A.列, 表B.列
FROM 表A
INNER JOIN 表B ON 表A.关联列 = 表B.关联列;</div>
            <p>例如查询订单和客户信息：</p>
            <div class="syntax-block">SELECT orders.id, customers.name, orders.product
FROM orders
INNER JOIN customers ON orders.customer_id = customers.id;</div>
        `,
        task: '请查询每笔订单的订单编号（<code>orders.id</code>）、客户姓名（<code>customers.name</code>）、商品（<code>orders.product</code>）和金额（<code>orders.amount</code>）。',
        hint: '使用 INNER JOIN customers ON orders.customer_id = customers.id 关联两表。',
        setupSQL: `
            CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, city TEXT);
            INSERT INTO customers VALUES (1, '张三', '北京');
            INSERT INTO customers VALUES (2, '李四', '上海');
            INSERT INTO customers VALUES (3, '王五', '广州');
            INSERT INTO customers VALUES (4, '赵六', '深圳');
            CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER, product TEXT, amount REAL);
            INSERT INTO orders VALUES (1, 1, '笔记本', 5999);
            INSERT INTO orders VALUES (2, 1, '鼠标', 199);
            INSERT INTO orders VALUES (3, 3, '键盘', 399);
        `,
        tables: [
            {
                name: 'customers',
                columns: ['id', 'name', 'city'],
                rows: [[1,'张三','北京'],[2,'李四','上海'],[3,'王五','广州'],[4,'赵六','深圳']]
            },
            {
                name: 'orders',
                columns: ['id', 'customer_id', 'product', 'amount'],
                rows: [[1,1,'笔记本',5999],[2,1,'鼠标',199],[3,3,'键盘',399]]
            }
        ],
        answerSQL: 'SELECT orders.id, customers.name, orders.product, orders.amount FROM orders INNER JOIN customers ON orders.customer_id = customers.id;',
        validate(userCols, userRows, expectedCols, expectedRows) {
            return defaultValidate(userCols, userRows, expectedCols, expectedRows);
        }
    },
    {
        id: 22,
        title: 'LEFT JOIN 左连接',
        description: '学习保留左表所有数据的连接',
        tutorial: `
            <p><code>LEFT JOIN</code> 返回左表的所有行，即使右表中没有匹配，未匹配的列显示 <code>NULL</code>：</p>
            <div class="syntax-block">SELECT A.列, B.列
FROM 表A
LEFT JOIN 表B ON A.关联列 = B.关联列;</div>
            <p><b>INNER JOIN</b> 只返回匹配的行，<b>LEFT JOIN</b> 保证左表数据完整。</p>
            <p>适用场景：查看所有客户，包括没有下过单的客户。</p>
        `,
        task: '请查询所有客户的姓名（<code>name</code>）及其订单的商品名（<code>product</code>），没有订单的客户也要显示（商品显示为NULL）。',
        hint: '使用 LEFT JOIN orders ON customers.id = orders.customer_id 保留所有客户数据。',
        setupSQL: `
            CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, city TEXT);
            INSERT INTO customers VALUES (1, '张三', '北京');
            INSERT INTO customers VALUES (2, '李四', '上海');
            INSERT INTO customers VALUES (3, '王五', '广州');
            INSERT INTO customers VALUES (4, '赵六', '深圳');
            CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER, product TEXT, amount REAL);
            INSERT INTO orders VALUES (1, 1, '笔记本', 5999);
            INSERT INTO orders VALUES (2, 1, '鼠标', 199);
            INSERT INTO orders VALUES (3, 3, '键盘', 399);
        `,
        tables: [
            {
                name: 'customers',
                columns: ['id', 'name', 'city'],
                rows: [[1,'张三','北京'],[2,'李四','上海'],[3,'王五','广州'],[4,'赵六','深圳']]
            },
            {
                name: 'orders',
                columns: ['id', 'customer_id', 'product', 'amount'],
                rows: [[1,1,'笔记本',5999],[2,1,'鼠标',199],[3,3,'键盘',399]]
            }
        ],
        answerSQL: 'SELECT customers.name, orders.product FROM customers LEFT JOIN orders ON customers.id = orders.customer_id;',
        validate(userCols, userRows, expectedCols, expectedRows) {
            return defaultValidate(userCols, userRows, expectedCols, expectedRows);
        }
    },
    {
        id: 23,
        title: 'JOIN + GROUP BY 综合',
        description: '学习连接后进行分组统计',
        tutorial: `
            <p>实际工作中，经常需要先 <code>JOIN</code> 关联多表，再用 <code>GROUP BY</code> 分组统计：</p>
            <div class="syntax-block">SELECT customers.name, COUNT(orders.id) AS 订单数
FROM customers
LEFT JOIN orders ON customers.id = orders.customer_id
GROUP BY customers.name;</div>
            <p>这种组合可以回答"每个客户下了多少单"这类问题。</p>
        `,
        task: '请查询每个客户的姓名（<code>name</code>）和总消费金额（<code>总消费</code>），按总消费从高到低排序。没有订单的客户总消费显示为0（使用 <code>COALESCE</code> 函数处理NULL：<code>COALESCE(SUM(amount), 0)</code>）。',
        hint: '使用 LEFT JOIN + GROUP BY + COALESCE(SUM(orders.amount), 0) + ORDER BY 总消费 DESC',
        setupSQL: `
            CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, city TEXT);
            INSERT INTO customers VALUES (1, '张三', '北京');
            INSERT INTO customers VALUES (2, '李四', '上海');
            INSERT INTO customers VALUES (3, '王五', '广州');
            INSERT INTO customers VALUES (4, '赵六', '深圳');
            CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER, product TEXT, amount REAL);
            INSERT INTO orders VALUES (1, 1, '笔记本', 5999);
            INSERT INTO orders VALUES (2, 1, '鼠标', 199);
            INSERT INTO orders VALUES (3, 3, '键盘', 399);
        `,
        tables: [
            {
                name: 'customers',
                columns: ['id', 'name', 'city'],
                rows: [[1,'张三','北京'],[2,'李四','上海'],[3,'王五','广州'],[4,'赵六','深圳']]
            },
            {
                name: 'orders',
                columns: ['id', 'customer_id', 'product', 'amount'],
                rows: [[1,1,'笔记本',5999],[2,1,'鼠标',199],[3,3,'键盘',399]]
            }
        ],
        answerSQL: 'SELECT customers.name, COALESCE(SUM(orders.amount), 0) AS 总消费 FROM customers LEFT JOIN orders ON customers.id = orders.customer_id GROUP BY customers.name ORDER BY 总消费 DESC;',
        validate(userCols, userRows, expectedCols, expectedRows) {
            return orderedValidate(userCols, userRows, expectedCols, expectedRows);
        }
    },
    {
        id: 24,
        title: 'UNION 联合查询',
        description: '学习合并多个查询的结果',
        tutorial: `
            <p><code>UNION</code> 用于合并两个 SELECT 的结果集（自动去重）：</p>
            <div class="syntax-block">SELECT 列 FROM 表A
UNION
SELECT 列 FROM 表B;</div>
            <p><code>UNION ALL</code> 则保留所有行（不去重）。</p>
            <p>要求：两个 SELECT 的列数和类型必须一致。</p>
        `,
        task: '请查询所有出现在 <code>orders_2024</code> 或 <code>orders_2025</code> 表中的不重复客户名（<code>customer</code>），结果列名为 <code>customer</code>。',
        hint: '使用 SELECT customer FROM orders_2024 UNION SELECT customer FROM orders_2025; UNION自动去重。',
        setupSQL: `
            CREATE TABLE orders_2024 (id INTEGER PRIMARY KEY, customer TEXT, amount REAL);
            INSERT INTO orders_2024 VALUES (1, '张三', 500);
            INSERT INTO orders_2024 VALUES (2, '李四', 300);
            INSERT INTO orders_2024 VALUES (3, '王五', 800);
            CREATE TABLE orders_2025 (id INTEGER PRIMARY KEY, customer TEXT, amount REAL);
            INSERT INTO orders_2025 VALUES (1, '张三', 600);
            INSERT INTO orders_2025 VALUES (2, '赵六', 450);
            INSERT INTO orders_2025 VALUES (3, '王五', 200);
        `,
        tables: [
            {
                name: 'orders_2024',
                columns: ['id', 'customer', 'amount'],
                rows: [[1,'张三',500],[2,'李四',300],[3,'王五',800]]
            },
            {
                name: 'orders_2025',
                columns: ['id', 'customer', 'amount'],
                rows: [[1,'张三',600],[2,'赵六',450],[3,'王五',200]]
            }
        ],
        answerSQL: 'SELECT customer FROM orders_2024 UNION SELECT customer FROM orders_2025;',
        validate(userCols, userRows, expectedCols, expectedRows) {
            return setValidate(userCols, userRows, expectedCols, expectedRows);
        }
    },
    {
        id: 25,
        title: '综合挑战：多表分析',
        description: '综合运用所学知识完成复杂查询',
        tutorial: `
            <p>现在来综合运用你学到的所有知识！</p>
            <p>场景：一个学校管理系统，有三张表：</p>
            <ul style="margin:8px 0 8px 20px;line-height:2;">
                <li><code>students</code> — 学生信息</li>
                <li><code>courses</code> — 课程信息</li>
                <li><code>scores</code> — 选课成绩（关联学生和课程）</li>
            </ul>
            <p>需要用到 <code>JOIN</code>、<code>GROUP BY</code>、<code>HAVING</code>、<code>ORDER BY</code> 和聚合函数。</p>
        `,
        task: '请查询选课数量大于等于2门的学生姓名（<code>name</code>）、选课数（<code>选课数</code>）和平均成绩（<code>平均成绩</code>），按平均成绩降序排列。',
        hint: '步骤：JOIN三表 → GROUP BY students.name → HAVING COUNT >= 2 → ORDER BY 平均成绩 DESC',
        setupSQL: `
            CREATE TABLE students (id INTEGER PRIMARY KEY, name TEXT, gender TEXT);
            INSERT INTO students VALUES (1, '张三', '男');
            INSERT INTO students VALUES (2, '李四', '女');
            INSERT INTO students VALUES (3, '王五', '男');
            INSERT INTO students VALUES (4, '赵六', '女');
            CREATE TABLE courses (id INTEGER PRIMARY KEY, course_name TEXT, teacher TEXT);
            INSERT INTO courses VALUES (1, '数学', '陈老师');
            INSERT INTO courses VALUES (2, '英语', '林老师');
            INSERT INTO courses VALUES (3, '物理', '周老师');
            CREATE TABLE scores (id INTEGER PRIMARY KEY, student_id INTEGER, course_id INTEGER, score REAL);
            INSERT INTO scores VALUES (1, 1, 1, 88);
            INSERT INTO scores VALUES (2, 1, 2, 76);
            INSERT INTO scores VALUES (3, 1, 3, 92);
            INSERT INTO scores VALUES (4, 2, 1, 95);
            INSERT INTO scores VALUES (5, 2, 2, 89);
            INSERT INTO scores VALUES (6, 3, 1, 72);
            INSERT INTO scores VALUES (7, 4, 2, 91);
            INSERT INTO scores VALUES (8, 4, 3, 85);
        `,
        tables: [
            {
                name: 'students',
                columns: ['id', 'name', 'gender'],
                rows: [[1,'张三','男'],[2,'李四','女'],[3,'王五','男'],[4,'赵六','女']]
            },
            {
                name: 'courses',
                columns: ['id', 'course_name', 'teacher'],
                rows: [[1,'数学','陈老师'],[2,'英语','林老师'],[3,'物理','周老师']]
            },
            {
                name: 'scores',
                columns: ['id', 'student_id', 'course_id', 'score'],
                rows: [[1,1,1,88],[2,1,2,76],[3,1,3,92],[4,2,1,95],[5,2,2,89],[6,3,1,72],[7,4,2,91],[8,4,3,85]]
            }
        ],
        answerSQL: 'SELECT students.name, COUNT(scores.id) AS 选课数, AVG(scores.score) AS 平均成绩 FROM students INNER JOIN scores ON students.id = scores.student_id GROUP BY students.name HAVING COUNT(scores.id) >= 2 ORDER BY 平均成绩 DESC;',
        validate(userCols, userRows, expectedCols, expectedRows) {
            return orderedValidate(userCols, userRows, expectedCols, expectedRows);
        }
    },
    {
        id: 26,
        title: 'INSERT INTO 插入数据',
        description: '学习向表中插入新数据',
        type: 'dml',
        tutorial: `
            <p><code>INSERT INTO</code> 用于向表中插入新行：</p>
            <div class="syntax-block">-- 指定所有列的值
INSERT INTO 表名 VALUES (值1, 值2, ...);

-- 指定部分列
INSERT INTO 表名 (列1, 列2) VALUES (值1, 值2);</div>
            <p>文本值用单引号包裹，数值直接写。</p>
        `,
        task: '请向 <code>students</code> 表中插入一条新记录：id为6，姓名"周八"，年龄19，性别"男"，成绩91.0。',
        hint: "使用 INSERT INTO students VALUES (6, '周八', 19, '男', 91.0);",
        setupSQL: `
            CREATE TABLE students (id INTEGER PRIMARY KEY, name TEXT, age INTEGER, gender TEXT, score REAL);
            INSERT INTO students VALUES (1, '张三', 20, '男', 85.5);
            INSERT INTO students VALUES (2, '李四', 22, '女', 92.0);
            INSERT INTO students VALUES (3, '王五', 21, '男', 78.0);
            INSERT INTO students VALUES (4, '赵六', 23, '女', 95.5);
            INSERT INTO students VALUES (5, '孙七', 20, '女', 88.0);
        `,
        tables: [{
            name: 'students',
            columns: ['id', 'name', 'age', 'gender', 'score'],
            rows: [
                [1,'张三',20,'男',85.5],[2,'李四',22,'女',92.0],[3,'王五',21,'男',78.0],
                [4,'赵六',23,'女',95.5],[5,'孙七',20,'女',88.0]
            ]
        }],
        verifySQL: 'SELECT * FROM students ORDER BY id;',
        answerDML: "INSERT INTO students VALUES (6, '周八', 19, '男', 91.0);",
        answerSQL: "SELECT * FROM students ORDER BY id;",
        validate(userCols, userRows, expectedCols, expectedRows) {
            return orderedValidate(userCols, userRows, expectedCols, expectedRows);
        }
    },
    {
        id: 27,
        title: 'UPDATE 更新数据',
        description: '学习修改表中已有数据',
        type: 'dml',
        tutorial: `
            <p><code>UPDATE</code> 用于修改表中已有的数据：</p>
            <div class="syntax-block">UPDATE 表名 SET 列名 = 新值 WHERE 条件;</div>
            <p>可以同时修改多列：</p>
            <div class="syntax-block">UPDATE 表名 SET 列1 = 值1, 列2 = 值2 WHERE 条件;</div>
            <p><b>重要：</b>一定要写 <code>WHERE</code> 条件，否则会更新所有行！</p>
        `,
        task: '请将 <code>employees</code> 表中"王芳"的薪资更新为 13500。',
        hint: "使用 UPDATE employees SET salary = 13500 WHERE name = '王芳';",
        setupSQL: `
            CREATE TABLE employees (id INTEGER PRIMARY KEY, name TEXT, department TEXT, salary REAL);
            INSERT INTO employees VALUES (1, '张伟', '技术部', 15000);
            INSERT INTO employees VALUES (2, '李娜', '市场部', 12000);
            INSERT INTO employees VALUES (3, '张敏', '技术部', 16000);
            INSERT INTO employees VALUES (4, '王芳', '人事部', 11000);
            INSERT INTO employees VALUES (5, '张强', '市场部', 13000);
            INSERT INTO employees VALUES (6, '刘洋', '技术部', 14500);
        `,
        tables: [{
            name: 'employees',
            columns: ['id', 'name', 'department', 'salary'],
            rows: [
                [1,'张伟','技术部',15000],[2,'李娜','市场部',12000],
                [3,'张敏','技术部',16000],[4,'王芳','人事部',11000],
                [5,'张强','市场部',13000],[6,'刘洋','技术部',14500]
            ]
        }],
        verifySQL: 'SELECT * FROM employees ORDER BY id;',
        answerDML: "UPDATE employees SET salary = 13500 WHERE name = '王芳';",
        answerSQL: 'SELECT * FROM employees ORDER BY id;',
        validate(userCols, userRows, expectedCols, expectedRows) {
            return orderedValidate(userCols, userRows, expectedCols, expectedRows);
        }
    },
    {
        id: 28,
        title: 'DELETE 删除数据',
        description: '学习从表中删除数据',
        type: 'dml',
        tutorial: `
            <p><code>DELETE</code> 用于删除表中的数据行：</p>
            <div class="syntax-block">DELETE FROM 表名 WHERE 条件;</div>
            <p>例如删除成绩低于60分的学生：</p>
            <div class="syntax-block">DELETE FROM students WHERE score < 60;</div>
            <p><b>重要：</b>不写 <code>WHERE</code> 会删除所有数据！</p>
        `,
        task: '请删除 <code>products</code> 表中库存（<code>stock</code>）为 0 的所有商品。',
        hint: '使用 DELETE FROM products WHERE stock = 0;',
        setupSQL: `
            CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, price REAL, stock INTEGER);
            INSERT INTO products VALUES (1, '笔记本', 5999, 50);
            INSERT INTO products VALUES (2, '鼠标', 199, 0);
            INSERT INTO products VALUES (3, '键盘', 399, 30);
            INSERT INTO products VALUES (4, '耳机', 299, 0);
            INSERT INTO products VALUES (5, '显示器', 2499, 15);
        `,
        tables: [{
            name: 'products',
            columns: ['id', 'name', 'price', 'stock'],
            rows: [
                [1,'笔记本',5999,50],[2,'鼠标',199,0],[3,'键盘',399,30],
                [4,'耳机',299,0],[5,'显示器',2499,15]
            ]
        }],
        verifySQL: 'SELECT * FROM products ORDER BY id;',
        answerDML: 'DELETE FROM products WHERE stock = 0;',
        answerSQL: 'SELECT * FROM products ORDER BY id;',
        validate(userCols, userRows, expectedCols, expectedRows) {
            return orderedValidate(userCols, userRows, expectedCols, expectedRows);
        }
    },
    {
        id: 29,
        title: 'CREATE TABLE 创建表',
        description: '学习创建新的数据表',
        type: 'dml',
        tutorial: `
            <p><code>CREATE TABLE</code> 用于创建新表：</p>
            <div class="syntax-block">CREATE TABLE 表名 (
  列名1 数据类型,
  列名2 数据类型,
  ...
);</div>
            <p>常用数据类型：</p>
            <ul style="margin:8px 0 8px 20px;line-height:2;">
                <li><code>INTEGER</code> — 整数</li>
                <li><code>REAL</code> — 浮点数</li>
                <li><code>TEXT</code> — 文本</li>
                <li><code>PRIMARY KEY</code> — 主键约束</li>
            </ul>
        `,
        task: '请创建一张 <code>books</code> 表，包含：<code>id</code>（INTEGER主键）、<code>title</code>（TEXT）、<code>author</code>（TEXT）、<code>price</code>（REAL）。然后插入一条数据：id=1, title="SQL入门", author="李明", price=49.9。',
        hint: "CREATE TABLE books (id INTEGER PRIMARY KEY, title TEXT, author TEXT, price REAL); 然后 INSERT INTO books VALUES (1, 'SQL入门', '李明', 49.9);",
        setupSQL: '',
        tables: [],
        verifySQL: 'SELECT * FROM books;',
        answerDML: "CREATE TABLE books (id INTEGER PRIMARY KEY, title TEXT, author TEXT, price REAL); INSERT INTO books VALUES (1, 'SQL入门', '李明', 49.9);",
        answerSQL: 'SELECT * FROM books;',
        validate(userCols, userRows, expectedCols, expectedRows) {
            return defaultValidate(userCols, userRows, expectedCols, expectedRows);
        }
    },
    {
        id: 30,
        title: '算术运算与函数',
        description: '学习在查询中进行计算',
        tutorial: `
            <p>SQL支持在查询中进行算术运算：</p>
            <div class="syntax-block">SELECT name, price * quantity AS 总价 FROM orders;
SELECT name, salary * 1.1 AS 加薪后 FROM employees;</div>
            <p>常用函数：</p>
            <ul style="margin:8px 0 8px 20px;line-height:2;">
                <li><code>ROUND(数值, 小数位)</code> — 四舍五入</li>
                <li><code>LENGTH(文本)</code> — 字符串长度</li>
                <li><code>UPPER(文本)</code> / <code>LOWER(文本)</code> — 大小写转换</li>
                <li><code>REPLACE(文本, 旧, 新)</code> — 替换</li>
            </ul>
        `,
        task: '请查询 <code>products</code> 表，输出商品名（<code>name</code>）、单价（<code>price</code>）、库存（<code>stock</code>）以及库存总价值（<code>price * stock</code>，列名为 <code>总价值</code>），并将总价值用 <code>ROUND</code> 保留2位小数。',
        hint: '使用 SELECT name, price, stock, ROUND(price * stock, 2) AS 总价值 FROM products;',
        setupSQL: `
            CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, price REAL, stock INTEGER);
            INSERT INTO products VALUES (1, '笔记本', 5999.50, 50);
            INSERT INTO products VALUES (2, '鼠标', 199.90, 120);
            INSERT INTO products VALUES (3, '键盘', 399.00, 30);
            INSERT INTO products VALUES (4, '显示器', 2499.99, 15);
        `,
        tables: [{
            name: 'products',
            columns: ['id', 'name', 'price', 'stock'],
            rows: [[1,'笔记本',5999.50,50],[2,'鼠标',199.90,120],[3,'键盘',399.00,30],[4,'显示器',2499.99,15]]
        }],
        answerSQL: 'SELECT name, price, stock, ROUND(price * stock, 2) AS 总价值 FROM products;',
        validate(userCols, userRows, expectedCols, expectedRows) {
            return defaultValidate(userCols, userRows, expectedCols, expectedRows);
        }
    },
    {
        id: 31,
        title: '字符串函数',
        description: '学习操作文本数据的函数',
        tutorial: `
            <p>SQL提供了丰富的字符串处理函数：</p>
            <div class="syntax-block">|| — 字符串拼接
SUBSTR(文本, 起始位, 长度) — 截取子串
REPLACE(文本, 旧, 新) — 替换
TRIM(文本) — 去除首尾空格
LENGTH(文本) — 字符串长度</div>
            <p>拼接示例：<code>SELECT name || ' - ' || department AS 信息 FROM employees;</code></p>
        `,
        task: '请查询 <code>employees</code> 表，输出格式为"姓名(部门)"的信息（列名 <code>员工信息</code>），例如"张伟(技术部)"。使用 <code>||</code> 拼接字符串。',
        hint: "使用 SELECT name || '(' || department || ')' AS 员工信息 FROM employees;",
        setupSQL: `
            CREATE TABLE employees (id INTEGER PRIMARY KEY, name TEXT, department TEXT, salary REAL);
            INSERT INTO employees VALUES (1, '张伟', '技术部', 15000);
            INSERT INTO employees VALUES (2, '李娜', '市场部', 12000);
            INSERT INTO employees VALUES (3, '张敏', '技术部', 16000);
            INSERT INTO employees VALUES (4, '王芳', '人事部', 11000);
        `,
        tables: [{
            name: 'employees',
            columns: ['id', 'name', 'department', 'salary'],
            rows: [[1,'张伟','技术部',15000],[2,'李娜','市场部',12000],[3,'张敏','技术部',16000],[4,'王芳','人事部',11000]]
        }],
        answerSQL: "SELECT name || '(' || department || ')' AS 员工信息 FROM employees;",
        validate(userCols, userRows, expectedCols, expectedRows) {
            return defaultValidate(userCols, userRows, expectedCols, expectedRows);
        }
    },
    {
        id: 32,
        title: 'EXISTS 子查询',
        description: '学习用 EXISTS 判断关联数据是否存在',
        tutorial: `
            <p><code>EXISTS</code> 用于判断子查询是否返回了任何行：</p>
            <div class="syntax-block">SELECT * FROM 表A
WHERE EXISTS (
  SELECT 1 FROM 表B WHERE 表B.外键 = 表A.主键
);</div>
            <p><code>EXISTS</code> 返回 TRUE/FALSE：</p>
            <ul style="margin:8px 0 8px 20px;line-height:2;">
                <li>子查询有结果 → TRUE → 保留该行</li>
                <li>子查询无结果 → FALSE → 过滤掉</li>
            </ul>
            <p><code>NOT EXISTS</code> 则相反，只保留子查询无结果的行。</p>
        `,
        task: '请使用 <code>NOT EXISTS</code> 查询没有下过任何订单的客户信息。',
        hint: '使用 WHERE NOT EXISTS (SELECT 1 FROM orders WHERE orders.customer_id = customers.id)',
        setupSQL: `
            CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, city TEXT);
            INSERT INTO customers VALUES (1, '张三', '北京');
            INSERT INTO customers VALUES (2, '李四', '上海');
            INSERT INTO customers VALUES (3, '王五', '广州');
            INSERT INTO customers VALUES (4, '赵六', '深圳');
            CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER, product TEXT, amount REAL);
            INSERT INTO orders VALUES (1, 1, '笔记本', 5999);
            INSERT INTO orders VALUES (2, 1, '鼠标', 199);
            INSERT INTO orders VALUES (3, 3, '键盘', 399);
        `,
        tables: [
            {
                name: 'customers',
                columns: ['id', 'name', 'city'],
                rows: [[1,'张三','北京'],[2,'李四','上海'],[3,'王五','广州'],[4,'赵六','深圳']]
            },
            {
                name: 'orders',
                columns: ['id', 'customer_id', 'product', 'amount'],
                rows: [[1,1,'笔记本',5999],[2,1,'鼠标',199],[3,3,'键盘',399]]
            }
        ],
        answerSQL: 'SELECT * FROM customers WHERE NOT EXISTS (SELECT 1 FROM orders WHERE orders.customer_id = customers.id);',
        validate(userCols, userRows, expectedCols, expectedRows) {
            return defaultValidate(userCols, userRows, expectedCols, expectedRows);
        }
    },
    {
        id: 33,
        title: '窗口函数 ROW_NUMBER',
        description: '学习给结果行编号',
        tutorial: `
            <p>窗口函数可以在不改变行数的情况下进行计算。<code>ROW_NUMBER()</code> 为每行分配一个序号：</p>
            <div class="syntax-block">SELECT
  ROW_NUMBER() OVER (ORDER BY 列名) AS 行号,
  其他列
FROM 表名;</div>
            <p>配合 <code>PARTITION BY</code> 可以分组编号：</p>
            <div class="syntax-block">ROW_NUMBER() OVER (
  PARTITION BY 分组列
  ORDER BY 排序列
) AS 组内行号</div>
        `,
        task: '请查询 <code>employees</code> 表，输出 <code>department</code>、<code>name</code>、<code>salary</code>，并添加一列 <code>部门排名</code>：按部门分组，在每个部门内按薪资从高到低编号。',
        hint: '使用 ROW_NUMBER() OVER (PARTITION BY department ORDER BY salary DESC) AS 部门排名',
        setupSQL: `
            CREATE TABLE employees (id INTEGER PRIMARY KEY, name TEXT, department TEXT, salary REAL);
            INSERT INTO employees VALUES (1, '张伟', '技术部', 15000);
            INSERT INTO employees VALUES (2, '李娜', '市场部', 12000);
            INSERT INTO employees VALUES (3, '张敏', '技术部', 16000);
            INSERT INTO employees VALUES (4, '王芳', '人事部', 11000);
            INSERT INTO employees VALUES (5, '张强', '市场部', 13000);
            INSERT INTO employees VALUES (6, '刘洋', '技术部', 14500);
        `,
        tables: [{
            name: 'employees',
            columns: ['id', 'name', 'department', 'salary'],
            rows: [
                [1,'张伟','技术部',15000],[2,'李娜','市场部',12000],
                [3,'张敏','技术部',16000],[4,'王芳','人事部',11000],
                [5,'张强','市场部',13000],[6,'刘洋','技术部',14500]
            ]
        }],
        answerSQL: 'SELECT department, name, salary, ROW_NUMBER() OVER (PARTITION BY department ORDER BY salary DESC) AS 部门排名 FROM employees;',
        validate(userCols, userRows, expectedCols, expectedRows) {
            return defaultValidate(userCols, userRows, expectedCols, expectedRows);
        }
    },
    {
        id: 34,
        title: '窗口函数 SUM OVER',
        description: '学习累计求和等窗口计算',
        tutorial: `
            <p>聚合函数也可以作为窗口函数使用，实现"累计"效果：</p>
            <div class="syntax-block">-- 累计求和
SELECT name, amount,
  SUM(amount) OVER (ORDER BY id) AS 累计金额
FROM orders;</div>
            <p>每行的 <code>累计金额</code> = 从第一行到当前行的 amount 之和。</p>
            <p>配合 <code>PARTITION BY</code> 可以分组累计。</p>
        `,
        task: '请查询 <code>sales</code> 表，输出 <code>month</code>（月份）、<code>revenue</code>（月收入）和 <code>累计收入</code>（按月份顺序的累计和），按月份升序排列。',
        hint: '使用 SUM(revenue) OVER (ORDER BY month) AS 累计收入',
        setupSQL: `
            CREATE TABLE sales (id INTEGER PRIMARY KEY, month TEXT, revenue REAL);
            INSERT INTO sales VALUES (1, '2025-01', 50000);
            INSERT INTO sales VALUES (2, '2025-02', 62000);
            INSERT INTO sales VALUES (3, '2025-03', 48000);
            INSERT INTO sales VALUES (4, '2025-04', 71000);
            INSERT INTO sales VALUES (5, '2025-05', 55000);
            INSERT INTO sales VALUES (6, '2025-06', 83000);
        `,
        tables: [{
            name: 'sales',
            columns: ['id', 'month', 'revenue'],
            rows: [
                [1,'2025-01',50000],[2,'2025-02',62000],[3,'2025-03',48000],
                [4,'2025-04',71000],[5,'2025-05',55000],[6,'2025-06',83000]
            ]
        }],
        answerSQL: 'SELECT month, revenue, SUM(revenue) OVER (ORDER BY month) AS 累计收入 FROM sales ORDER BY month;',
        validate(userCols, userRows, expectedCols, expectedRows) {
            return orderedValidate(userCols, userRows, expectedCols, expectedRows);
        }
    },
    {
        id: 35,
        title: '终极挑战：电商数据分析',
        description: '综合运用全部知识完成复杂业务查询',
        tutorial: `
            <p>你已经掌握了SQL的核心知识！现在用一个真实的电商场景来检验：</p>
            <p>系统有四张表：</p>
            <ul style="margin:8px 0 8px 20px;line-height:2;">
                <li><code>users</code> — 用户表</li>
                <li><code>products</code> — 商品表</li>
                <li><code>orders</code> — 订单表</li>
                <li><code>order_items</code> — 订单明细表</li>
            </ul>
            <p>你需要组合使用多表JOIN、聚合、分组、排序等技巧。</p>
        `,
        task: '请查询每个用户的姓名（<code>name</code>）、总消费金额（<code>总消费</code>，即所有订单明细的 <code>price * quantity</code> 之和），以及购买的不同商品数量（<code>商品种类数</code>）。只显示总消费大于 500 的用户，按总消费降序排列。',
        hint: '思路：users JOIN orders JOIN order_items → GROUP BY users.name → SUM(price*quantity) AS 总消费, COUNT(DISTINCT product_id) AS 商品种类数 → HAVING 总消费 > 500 → ORDER BY 总消费 DESC',
        setupSQL: `
            CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, city TEXT);
            INSERT INTO users VALUES (1, '张三', '北京');
            INSERT INTO users VALUES (2, '李四', '上海');
            INSERT INTO users VALUES (3, '王五', '广州');
            CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, category TEXT);
            INSERT INTO products VALUES (1, '笔记本电脑', '电子');
            INSERT INTO products VALUES (2, '无线鼠标', '电子');
            INSERT INTO products VALUES (3, 'SQL教程书', '图书');
            INSERT INTO products VALUES (4, '机械键盘', '电子');
            CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER, order_date TEXT);
            INSERT INTO orders VALUES (1, 1, '2025-01-10');
            INSERT INTO orders VALUES (2, 1, '2025-02-15');
            INSERT INTO orders VALUES (3, 2, '2025-01-20');
            INSERT INTO orders VALUES (4, 3, '2025-03-05');
            CREATE TABLE order_items (id INTEGER PRIMARY KEY, order_id INTEGER, product_id INTEGER, price REAL, quantity INTEGER);
            INSERT INTO order_items VALUES (1, 1, 1, 5999, 1);
            INSERT INTO order_items VALUES (2, 1, 2, 199, 2);
            INSERT INTO order_items VALUES (3, 2, 3, 59, 3);
            INSERT INTO order_items VALUES (4, 2, 4, 499, 1);
            INSERT INTO order_items VALUES (5, 3, 2, 199, 1);
            INSERT INTO order_items VALUES (6, 3, 3, 59, 2);
            INSERT INTO order_items VALUES (7, 4, 4, 499, 1);
        `,
        tables: [
            {
                name: 'users',
                columns: ['id', 'name', 'city'],
                rows: [[1,'张三','北京'],[2,'李四','上海'],[3,'王五','广州']]
            },
            {
                name: 'products',
                columns: ['id', 'name', 'category'],
                rows: [[1,'笔记本电脑','电子'],[2,'无线鼠标','电子'],[3,'SQL教程书','图书'],[4,'机械键盘','电子']]
            },
            {
                name: 'orders',
                columns: ['id', 'user_id', 'order_date'],
                rows: [[1,1,'2025-01-10'],[2,1,'2025-02-15'],[3,2,'2025-01-20'],[4,3,'2025-03-05']]
            },
            {
                name: 'order_items',
                columns: ['id', 'order_id', 'product_id', 'price', 'quantity'],
                rows: [[1,1,1,5999,1],[2,1,2,199,2],[3,2,3,59,3],[4,2,4,499,1],[5,3,2,199,1],[6,3,3,59,2],[7,4,4,499,1]]
            }
        ],
        answerSQL: 'SELECT users.name, SUM(order_items.price * order_items.quantity) AS 总消费, COUNT(DISTINCT order_items.product_id) AS 商品种类数 FROM users INNER JOIN orders ON users.id = orders.user_id INNER JOIN order_items ON orders.id = order_items.order_id GROUP BY users.name HAVING 总消费 > 500 ORDER BY 总消费 DESC;',
        validate(userCols, userRows, expectedCols, expectedRows) {
            return orderedValidate(userCols, userRows, expectedCols, expectedRows);
        }
    }
];

// ===== 验证函数 =====
// 默认验证：列名匹配 + 行内容匹配（不考虑顺序）
function defaultValidate(userCols, userRows, expectedCols, expectedRows) {
    if (!colsMatch(userCols, expectedCols)) return false;
    if (userRows.length !== expectedRows.length) return false;
    const uSet = rowsToSet(userRows);
    const eSet = rowsToSet(expectedRows);
    return setsEqual(uSet, eSet);
}

// 严格顺序验证
function orderedValidate(userCols, userRows, expectedCols, expectedRows) {
    if (!colsMatch(userCols, expectedCols)) return false;
    if (userRows.length !== expectedRows.length) return false;
    for (let i = 0; i < userRows.length; i++) {
        if (rowToString(userRows[i]) !== rowToString(expectedRows[i])) return false;
    }
    return true;
}

// 集合验证（不检查列名，只检查值集合）
function setValidate(userCols, userRows, expectedCols, expectedRows) {
    if (userCols.length !== expectedCols.length) return false;
    if (userRows.length !== expectedRows.length) return false;
    const uSet = rowsToSet(userRows);
    const eSet = rowsToSet(expectedRows);
    return setsEqual(uSet, eSet);
}

function colsMatch(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i].toLowerCase() !== b[i].toLowerCase()) return false;
    }
    return true;
}

function rowToString(row) {
    return row.map(v => (v === null ? 'NULL' : String(v))).join('|');
}

function rowsToSet(rows) {
    return new Set(rows.map(r => rowToString(r)));
}

function setsEqual(a, b) {
    if (a.size !== b.size) return false;
    for (const item of a) {
        if (!b.has(item)) return false;
    }
    return true;
}

// ===== 全局状态 =====
let db = null;
let currentLevelIdx = -1;
const STORAGE_KEY = 'sql_learn_progress';

function getProgress() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch { return {}; }
}

function saveProgress(levelId) {
    const p = getProgress();
    p[levelId] = true;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
}

function isLevelCompleted(levelId) {
    return !!getProgress()[levelId];
}

function isLevelUnlocked(idx) {
    if (idx === 0) return true;
    return isLevelCompleted(LEVELS[idx - 1].id);
}

function getCompletedCount() {
    const p = getProgress();
    return LEVELS.filter(l => p[l.id]).length;
}

// ===== SQL引擎 =====
let sqlReady = false;
let SQL = null;

async function initSQL() {
    SQL = await initSqlJs();
    sqlReady = true;
}

function createDB(setupSQL) {
    if (db) db.close();
    db = new SQL.Database();
    db.run(setupSQL);
}

function runQuery(sql) {
    try {
        const results = db.exec(sql);
        if (!results || results.length === 0) {
            return { columns: [], rows: [], empty: true };
        }
        return { columns: results[0].columns, rows: results[0].values, empty: false };
    } catch (e) {
        return { error: e.message };
    }
}

// ===== UI渲染 =====
function goBack() {
    if (currentLevelIdx >= 0) {
        showLevelSelect();
    } else {
        window.location.href = '../../index.html';
    }
}

function showLevelSelect() {
    currentLevelIdx = -1;
    document.getElementById('levelSelect').style.display = '';
    document.getElementById('levelDetail').style.display = 'none';
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
        let cls = 'level-card';
        if (done) cls += ' completed';
        if (!unlocked) cls += ' locked';
        return `
            <div class="${cls}" data-idx="${idx}">
                ${!unlocked ? '<div class="lock-icon">🔒</div>' : ''}
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

    document.getElementById('levelTitle').textContent = `第 ${level.id} 关：${level.title}`;
    document.getElementById('tutorialContent').innerHTML = level.tutorial;
    document.getElementById('taskContent').innerHTML = level.task;

    // 渲染表预览
    const tablePreview = document.getElementById('tablePreview');
    tablePreview.innerHTML = level.tables.map(t => `
        <div class="table-name">表名：${t.name}</div>
        ${buildHTMLTable(t.columns, t.rows, 'preview-table')}
    `).join('');

    // 编辑器和结果重置
    document.getElementById('sqlEditor').value = '';
    document.getElementById('resultArea').innerHTML = '<p class="placeholder-text">运行SQL后在此查看结果</p>';
    document.getElementById('hintBox').style.display = 'none';
    document.getElementById('expectedSection').style.display = 'none';

    // 导航按钮
    document.getElementById('btnPrevLevel').disabled = (idx === 0);
    const nextUnlocked = idx + 1 < LEVELS.length && isLevelUnlocked(idx + 1);
    document.getElementById('btnNextLevel').disabled = !nextUnlocked;

    // 初始化本关数据库
    createDB(level.setupSQL);
}

function buildHTMLTable(columns, rows, cls) {
    let html = `<table class="${cls}"><thead><tr>`;
    columns.forEach(c => { html += `<th>${c}</th>`; });
    html += '</tr></thead><tbody>';
    rows.forEach(row => {
        html += '<tr>';
        row.forEach(v => { html += `<td>${v === null ? 'NULL' : v}</td>`; });
        html += '</tr>';
    });
    html += '</tbody></table>';
    return html;
}

function handleRun() {
    const level = LEVELS[currentLevelIdx];
    const sql = document.getElementById('sqlEditor').value.trim();
    if (!sql) return;

    const isDML = level.type === 'dml';
    const resultArea = document.getElementById('resultArea');

    // 重建数据库
    createDB(level.setupSQL);

    if (isDML) {
        // DML关卡：先执行用户SQL，再用 verifySQL 查看结果
        const execResult = runQuery(sql);
        if (execResult.error) {
            resultArea.innerHTML = `<div class="error-msg">❌ 错误：${execResult.error}</div>`;
            return;
        }

        // 执行验证查询
        const userVerify = runQuery(level.verifySQL);
        if (userVerify.error) {
            resultArea.innerHTML = `<div class="error-msg">❌ 验证出错：${userVerify.error}</div>`;
            return;
        }

        if (userVerify.empty) {
            resultArea.innerHTML = '<p class="placeholder-text">执行后表中无数据</p>';
        } else {
            resultArea.innerHTML = '<div style="margin-bottom:8px;color:rgba(255,255,255,0.5);font-size:13px;">执行后数据状态：</div>' +
                buildHTMLTable(userVerify.columns, userVerify.rows, 'result-table');
        }

        // 获取期望结果：重建数据库 → 执行标准答案DML → 验证查询
        createDB(level.setupSQL);
        runQuery(level.answerDML);
        const expectedResult = runQuery(level.verifySQL);

        const pass = level.validate(
            userVerify.columns || [],
            userVerify.rows || [],
            expectedResult.columns || [],
            expectedResult.rows || []
        );

        if (pass) {
            resultArea.innerHTML = '<div class="success-msg">✅ 完全正确！</div>' + resultArea.innerHTML;
            document.getElementById('expectedSection').style.display = 'none';
            saveProgress(level.id);
            showSuccessModal(level);
        } else {
            resultArea.innerHTML = '<div class="fail-msg">⚠️ 结果不正确，请检查你的SQL语句</div>' + resultArea.innerHTML;
            const expectedSection = document.getElementById('expectedSection');
            expectedSection.style.display = '';
            document.getElementById('expectedArea').innerHTML = '<div style="margin-bottom:8px;color:rgba(255,255,255,0.5);font-size:13px;">期望的数据状态：</div>' +
                buildHTMLTable(expectedResult.columns, expectedResult.rows, 'result-table');
        }
    } else {
        // 普通SELECT关卡
        const userResult = runQuery(sql);

        if (userResult.error) {
            resultArea.innerHTML = `<div class="error-msg">❌ 错误：${userResult.error}</div>`;
            return;
        }

        if (userResult.empty) {
            resultArea.innerHTML = '<p class="placeholder-text">查询未返回任何数据</p>';
        } else {
            resultArea.innerHTML = buildHTMLTable(userResult.columns, userResult.rows, 'result-table');
        }

        // 获取期望结果
        createDB(level.setupSQL);
        const expectedResult = runQuery(level.answerSQL);

        const pass = level.validate(
            userResult.columns || [],
            userResult.rows || [],
            expectedResult.columns || [],
            expectedResult.rows || []
        );

        if (pass) {
            resultArea.innerHTML = '<div class="success-msg">✅ 完全正确！</div>' + resultArea.innerHTML;
            document.getElementById('expectedSection').style.display = 'none';
            saveProgress(level.id);
            showSuccessModal(level);
        } else {
            resultArea.innerHTML = '<div class="fail-msg">⚠️ 结果不正确，请检查你的SQL语句</div>' + resultArea.innerHTML;
            const expectedSection = document.getElementById('expectedSection');
            expectedSection.style.display = '';
            document.getElementById('expectedArea').innerHTML = buildHTMLTable(
                expectedResult.columns, expectedResult.rows, 'result-table'
            );
        }
    }
}

function showSuccessModal(level) {
    const modal = document.getElementById('successModal');
    const idx = LEVELS.indexOf(level);
    const isLast = idx === LEVELS.length - 1;

    document.getElementById('successMsg').textContent = isLast
        ? '你已完成所有当前关卡，更多关卡敬请期待！'
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
document.addEventListener('DOMContentLoaded', async () => {
    await initSQL();
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
    document.getElementById('sqlEditor').addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            handleRun();
        }
    });
});
