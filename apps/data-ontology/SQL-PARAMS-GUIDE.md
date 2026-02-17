# SQL参数语法指南

## 🎯 MyBatis参数语法

数据本体池支持MyBatis风格的SQL参数化，有两种语法：

### 1. 预编译参数 `#{}` - 推荐用于数据

**语法**: `#{参数名}`

**特点**:
- ✅ 使用预编译语句（Prepared Statement）
- ✅ 自动防止SQL注入
- ✅ 自动处理引号转义
- ❌ 不能用于表名、列名

**适用场景**:
```sql
-- ✅ 数据查询
SELECT * FROM users WHERE id = #{user_id}

-- ✅ 数据过滤
SELECT * FROM products WHERE price > #{min_price} AND category = #{category}

-- ✅ 数据插入
INSERT INTO users (name, email) VALUES (#{name}, #{email})

-- ✅ 数据更新
UPDATE users SET status = #{status} WHERE id = #{id}
```

### 2. 直接替换 `${}` - 用于表名、列名

**语法**: `${参数名}`

**特点**:
- ✅ 直接字符串替换
- ✅ 可用于表名、列名
- ⚠️ 需要注意SQL注入风险
- ⚠️ 不会自动添加引号

**适用场景**:
```sql
-- ✅ 动态表名
SELECT * FROM ${table_name}

-- ✅ 动态列名
SELECT ${column_name} FROM users

-- ✅ DDL语句（CREATE/DROP/ALTER）
CREATE TABLE ${table_name} (${column_name} ${data_type})

-- ✅ ORDER BY子句
SELECT * FROM users ORDER BY ${sort_column} ${sort_order}
```

## ⚠️ 常见错误

### 错误 1: DDL语句使用预编译参数

❌ **错误示例**:
```sql
CREATE TABLE #{table_name} (
    #{column_name} #{data_type}
)
```

**错误信息**: `You have an error in your SQL syntax... near '? (? ?)'`

✅ **正确写法**:
```sql
CREATE TABLE ${table_name} (
    ${column_name} ${data_type}
)
```

### 错误 2: WHERE条件使用直接替换

⚠️ **不推荐**:
```sql
SELECT * FROM users WHERE id = ${user_id}
```

**风险**: 如果 `user_id` 是 `1 OR 1=1`，会导致SQL注入！

✅ **正确写法**:
```sql
SELECT * FROM users WHERE id = #{user_id}
```

### 错误 3: 混淆两种语法

❌ **错误示例**:
```sql
SELECT * FROM ${table_name} WHERE id = ${id}
--            ^^^^^^^^^^^^^ 正确    ^^^^^^^ 错误（应该用#{}）
```

✅ **正确写法**:
```sql
SELECT * FROM ${table_name} WHERE id = #{id}
--            ^^^^^^^^^^^^^ 表名用${}  ^^^^^ 数据用#{}
```

## 📋 使用决策树

```
是DDL语句（CREATE/DROP/ALTER）？
├─ 是 → 使用 ${} 直接替换
└─ 否 → 
    └─ 是表名或列名？
        ├─ 是 → 使用 ${} 直接替换
        └─ 否 → 使用 #{} 预编译参数（推荐）
```

## 🔧 快速修复

如果你的接口SQL使用了错误的参数语法，在接口详情页面会显示：

```
⚠️ SQL语法错误
DDL语句（CREATE/DROP/ALTER）不能使用预编译参数 #{}，请改用直接替换 ${}

建议修复：
❌ CREATE TABLE #{table_name} (#{column_name} #{data_type})
✅ CREATE TABLE ${table_name} (${column_name} ${data_type})

[🔧 一键修复]
```

点击"🔧 一键修复"按钮可以自动修复SQL语法。

## 📝 完整示例

### 示例 1: 查询用户

```sql
-- 接口名称: 查询用户
-- 路径: /api/users
-- 方法: GET

SELECT id, name, email, created_at 
FROM users 
WHERE status = #{status} 
  AND created_at > #{start_date}
ORDER BY created_at DESC
LIMIT #{limit}
```

### 示例 2: 动态表查询

```sql
-- 接口名称: 动态表查询
-- 路径: /api/query_table
-- 方法: GET

SELECT * 
FROM ${table_name} 
WHERE ${column_name} = #{value}
LIMIT 100
```

### 示例 3: 创建新表（正确）

```sql
-- 接口名称: 创建新表
-- 路径: /api/create_table
-- 方法: POST

CREATE TABLE ${table_name} (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ${column_name} ${data_type},
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

## 🛡️ 安全建议

1. **优先使用 `#{}`**: 除非必要，总是使用预编译参数
2. **验证 `${}` 参数**: 如果必须使用 `${}`，在应用层验证参数值
3. **白名单验证**: 对表名、列名使用白名单验证
4. **避免用户输入**: `${}` 参数不要直接使用用户输入

## 🎓 延伸阅读

- **预编译语句**: 数据库会预编译SQL，参数值在执行时绑定，安全高效
- **SQL注入**: 攻击者通过构造恶意参数来执行非预期的SQL
- **MyBatis**: Java持久层框架，本项目借鉴了其参数化语法
